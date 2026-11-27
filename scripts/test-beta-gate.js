#!/usr/bin/env node
/**
 * Tests the beta gate template without deploying it (2026-11-27).
 *
 * The gate is the only thing standing between the public internet and an
 * unreleased beta, so the important properties are pinned here:
 *   - unauthenticated HTML gets the gate page, never the app;
 *   - unauthenticated assets/API get 401;
 *   - a wrong passphrase does not set a cookie;
 *   - a correct passphrase sets a signed, HttpOnly, Secure cookie and redirects
 *     only to a same-origin path;
 *   - missing/expired/tampered cookies are rejected;
 *   - /sw.js without a cookie is a self-destructing worker, so a visitor who
 *     loaded the beta before the gate cannot keep using the cached app;
 *   - the build script refuses to produce an ungated artefact.
 *
 * Hermetic: no network, no Firebase, no build output required.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'scripts', 'beta-gate', 'middleware.js');
const BUILDER = path.join(ROOT, 'scripts', 'build-beta-gate.js');

const PASSPHRASE = 'correct-horse-battery-staple-2026';
const PASS_HASH = crypto.createHash('sha256').update('rekindle-beta-pass-v1|' + PASSPHRASE).digest('hex');
const COOKIE_SECRET = crypto.createHash('sha256').update('rekindle-beta-cookie-v1|' + PASSPHRASE).digest('hex');

let source = fs.readFileSync(TEMPLATE, 'utf8');
source = source.replace(/__PASS_HASH__/g, PASS_HASH).replace(/__COOKIE_SECRET__/g, COOKIE_SECRET);
source = source.replace('export const onRequest', 'const onRequest');
source += '\nglobalThis.__betaOnRequest = onRequest;\n';

const sandbox = {
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    setTimeout: globalThis.setTimeout,
    console: console
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'beta-gate-middleware.js' });

const ORIGIN = 'https://beta.rekindle.ink';

async function call(pathname, options) {
    const opts = options || {};
    const request = new Request(ORIGIN + pathname, opts);
    return sandbox.__betaOnRequest({
        request: request,
        next: async () => new Response('APP_OK', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-App': '1' }
        })
    });
}

function cookieFor(exp, secret) {
    const sig = crypto.createHmac('sha256', secret || COOKIE_SECRET).update('v1|' + exp).digest('hex');
    return 'rk_beta=' + exp + '.' + sig;
}

function formBody(fields) {
    return Object.keys(fields).map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key]);
    }).join('&');
}

let passed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log('  ok  ' + name);
    } catch (err) {
        console.error('  FAIL ' + name);
        throw err;
    }
}

async function main() {
    console.log('beta gate: HTTP behaviour');

    await test('unauthenticated HTML gets the gate page, not the app', async () => {
        const res = await call('/');
        const body = await res.text();
        assert.strictEqual(res.status, 200);
        assert.ok(body.indexOf('This build is private') !== -1);
        assert.strictEqual(body.indexOf('APP_OK'), -1);
        assert.strictEqual(res.headers.get('cache-control'), 'no-store, max-age=0');
        assert.ok((res.headers.get('x-robots-tag') || '').indexOf('noindex') !== -1);
        assert.strictEqual(res.headers.get('content-security-policy').indexOf("default-src 'none'"), 0);
    });

    await test('deep link is preserved in the gate form', async () => {
        const res = await call('/reader?book=42');
        const body = await res.text();
        assert.ok(body.indexOf('name="next" value="/reader?book=42"') !== -1);
    });

    await test('unauthenticated assets and API are 401', async () => {
        const asset = await call('/js/home.js?v=25', { headers: { Accept: '*/*' } });
        assert.strictEqual(asset.status, 401);
        const api = await call('/api/proxy?url=x', { headers: { Accept: 'application/json' } });
        assert.strictEqual(api.status, 401);
    });

    await test('the ACME challenge path stays open for certificate renewal', async () => {
        const res = await call('/.well-known/acme-challenge/token-123', { headers: { Accept: '*/*' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(await res.text(), 'APP_OK');
    });

    await test('/sw.js without a cookie is a self-destructing worker', async () => {
        const res = await call('/sw.js', { headers: { Accept: '*/*' } });
        const js = await res.text();
        assert.strictEqual(res.status, 200);
        assert.ok((res.headers.get('content-type') || '').indexOf('javascript') !== -1);
        assert.ok(js.indexOf('caches.delete') !== -1);
        assert.ok(js.indexOf('unregister') !== -1);
    });

    await test('a valid cookie passes through to the app', async () => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const res = await call('/', { headers: { Cookie: cookieFor(exp) } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(await res.text(), 'APP_OK');
        assert.strictEqual(res.headers.get('x-app'), '1');
    });

    await test('expired and tampered cookies are rejected', async () => {
        const expired = Math.floor(Date.now() / 1000) - 10;
        assert.strictEqual((await call('/', { headers: { Cookie: cookieFor(expired) } })).status, 200);
        const body = await (await call('/', { headers: { Cookie: cookieFor(expired) } })).text();
        assert.ok(body.indexOf('This build is private') !== -1);

        const exp = Math.floor(Date.now() / 1000) + 3600;
        const tampered = 'rk_beta=' + exp + '.' + 'a'.repeat(64);
        assert.ok((await (await call('/', { headers: { Cookie: tampered } })).text()).indexOf('This build is private') !== -1);

        const wrongSecret = cookieFor(exp, 'not-the-cookie-secret');
        assert.ok((await (await call('/', { headers: { Cookie: wrongSecret } })).text()).indexOf('This build is private') !== -1);
    });

    await test('wrong passphrase returns the form with an error and no cookie', async () => {
        const res = await call('/__beta_gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody({ passphrase: 'not-it', next: '/reader' })
        });
        const body = await res.text();
        assert.strictEqual(res.status, 200);
        assert.ok(body.indexOf('Incorrect passphrase') !== -1);
        assert.strictEqual(res.headers.get('set-cookie'), null);
    });

    await test('correct passphrase sets a signed cookie and redirects', async () => {
        const res = await call('/__beta_gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody({ passphrase: PASSPHRASE, next: '/reader?book=42' })
        });
        assert.strictEqual(res.status, 302);
        assert.strictEqual(res.headers.get('location'), ORIGIN + '/reader?book=42');
        const setCookie = res.headers.get('set-cookie') || '';
        assert.ok(setCookie.indexOf('rk_beta=') !== -1);
        assert.ok(setCookie.indexOf('HttpOnly') !== -1);
        assert.ok(setCookie.indexOf('Secure') !== -1);
        assert.ok(setCookie.indexOf('Max-Age=7776000') !== -1);

        const value = setCookie.split(';')[0].split('=')[1];
        const follow = await call('/reader?book=42', { headers: { Cookie: 'rk_beta=' + value } });
        assert.strictEqual(await follow.text(), 'APP_OK');
    });

    await test('the next parameter cannot redirect off-site', async () => {
        for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', '\\\\evil.example']) {
            const res = await call('/__beta_gate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formBody({ passphrase: PASSPHRASE, next: next })
            });
            assert.strictEqual(res.status, 302);
            assert.strictEqual(res.headers.get('location'), ORIGIN + '/', 'leaked redirect for ' + next);
        }
    });

    await test('the cookie cannot be truncated or forged with a valid expiry alone', async () => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        for (const value of ['rk_beta=' + exp, 'rk_beta=' + exp + '.', 'rk_beta=abc.' + 'a'.repeat(64), 'rk_beta=' + exp + '.zzzz']) {
            assert.ok((await (await call('/', { headers: { Cookie: value } })).text()).indexOf('This build is private') !== -1);
        }
    });

    console.log('beta gate: build script fails closed');

    await test('build refuses without a passphrase', () => {
        const env = Object.assign({}, process.env);
        delete env.BETA_GATE_PASSPHRASE;
        const res = spawnSync(process.execPath, [BUILDER], { cwd: ROOT, env: env, encoding: 'utf8' });
        assert.notStrictEqual(res.status, 0);
        assert.ok((res.stderr + res.stdout).indexOf('BETA_GATE_PASSPHRASE is not set') !== -1);
    });

    await test('build refuses a short passphrase', () => {
        const res = spawnSync(process.execPath, [BUILDER], {
            cwd: ROOT,
            env: Object.assign({}, process.env, { BETA_GATE_PASSPHRASE: '1234567' }),
            encoding: 'utf8'
        });
        assert.notStrictEqual(res.status, 0);
        assert.ok((res.stderr + res.stdout).indexOf('at least 8 characters') !== -1);
    });

    console.log('\n' + passed + ' beta gate checks passed');
}

main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
