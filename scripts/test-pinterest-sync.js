/**
 * Cross-device Pinterest connection (pinterest.html).
 *
 * Run:  node scripts/test-pinterest-sync.js
 *
 * Why this exists: Pinterest's login page cannot render in the Kindle browser
 * (users saw a blank screen - suggestions `-OxvIdfe-PjCiChFpliq`), so a token
 * can only be won on a phone/PC. It is now mirrored to
 * users/{uid}/pro_data/pinterest, the same place Dropbox and Bluesky keep
 * theirs, so a Kindle picks it up from the account instead of trying to
 * authorise. This drives the real inline script with a stubbed DOM/Firebase -
 * no jsdom dependency - and asserts the whole lifecycle: restore, refresh,
 * connect, one-time backfill, and "Disconnect means everywhere".
 *
 * Keep in sync with pinterest.html if the storage keys or doc path change.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE = path.join(__dirname, '..', 'pinterest.html');
const DOC = 'users/U1/pro_data/pinterest';
const KINDLE_UA = 'Mozilla/5.0 (X11; U; Linux armv7l like Android) AppleWebKit/531.2+ Kindle/3.0+';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function element(id) {
    const el = {
        id: id || '',
        _text: '',
        innerHTML: '',
        className: '',
        style: {},
        dataset: {},
        children: [],
        onclick: null,
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        appendChild(c) { this.children.push(c); },
        setAttribute() {},
        addEventListener() {},
        querySelectorAll() { return []; }
    };
    Object.defineProperty(el, 'textContent', {
        get() { return this._text; },
        set(v) {
            this._text = String(v);
            this.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    });
    return el;
}

/**
 * Boot the page's inline script against stubs.
 * opts: { uid, ua, search, local, gate }
 */
function boot(opts) {
    opts = opts || {};
    const els = {};
    const store = {};        // fake Firestore: doc path -> data
    const deleted = [];
    const writes = [];
    const fetches = [];

    const document = {
        title: 'Pinterest',
        getElementById(id) {
            if (!els[id]) els[id] = element(id);
            return els[id];
        },
        querySelectorAll(sel) {
            if (sel === '.app-view') return [element('view-a'), element('view-b')];
            if (sel === '.nav-item') return [element('nav-a'), element('nav-b')];
            return [];
        },
        querySelector() { return element('q'); },
        createElement(tag) { return element(tag); },
        head: element('head'),
        body: element('body'),
        addEventListener() {}
    };

    const localStorage = {
        data: Object.assign({}, opts.local || {}),
        getItem(k) {
            return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null;
        },
        setItem(k, v) { this.data[k] = String(v); },
        removeItem(k) { delete this.data[k]; }
    };

    const docRef = (docPath) => ({
        get: async () => ({
            exists: Object.prototype.hasOwnProperty.call(store, docPath),
            data: () => store[docPath]
        }),
        set: async (data) => {
            store[docPath] = Object.assign({}, store[docPath], data);
            writes.push({ path: docPath, data });
        },
        delete: async () => {
            delete store[docPath];
            deleted.push(docPath);
        }
    });

    const user = opts.uid === null ? null : { uid: opts.uid || 'U1' };

    const firebase = {
        auth: () => ({
            currentUser: user,
            onAuthStateChanged: (cb) => { if (user) cb(user); }
        }),
        firestore: Object.assign(() => ({
            collection: (name) => ({
                doc: (id) => ({
                    collection: (sub) => ({
                        doc: (subId) => docRef(name + '/' + id + '/' + sub + '/' + subId)
                    })
                })
            })
        }), { FieldValue: { serverTimestamp: () => 'SERVER_TS' } })
    };

    const fetch = async (url, init) => {
        const u = String(url);
        fetches.push({ url: u, method: (init && init.method) || 'GET' });
        if (u.indexOf('/refresh') >= 0) {
            return { ok: true, json: async () => ({ access_token: 'REFRESHED', refresh_token: 'RT2', expires_in: 3600 }) };
        }
        if (u.indexOf('/oauth') >= 0) {
            return { ok: true, json: async () => ({ access_token: 'NEW_TOKEN', refresh_token: 'NEW_REFRESH', expires_in: 3600 }) };
        }
        return { ok: true, json: async () => ({ items: [], bookmark: '' }) };
    };

    const window = {
        location: { search: opts.search || '', pathname: '/pinterest.html', origin: 'https://rekindle.invalid', href: '' },
        history: { replaceState() {} },
        I18n: undefined,
        firebase: firebase,
        rekindleProGate: opts.gate === false ? undefined : {
            check: (cb) => cb(true),
            isPro: () => true,
            getUser: () => user
        }
    };

    const ctx = {
        window,
        document,
        localStorage,
        navigator: { userAgent: opts.ua || DESKTOP_UA },
        fetch,
        firebase,
        console: { log() {}, warn() {}, error: console.error },
        setTimeout,
        clearTimeout,
        Promise,
        URL,
        URLSearchParams,
        Date,
        JSON,
        Math,
        parseInt,
        parseFloat,
        String,
        Number,
        Object,
        Array,
        RegExp,
        Error,
        encodeURIComponent,
        decodeURIComponent
    };
    ctx.globalThis = ctx;
    ctx.self = ctx;

    const html = fs.readFileSync(PAGE, 'utf8');
    const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i)[1]
        .replace(/<\/script>/g, '') + '\n;globalThis.__app = app;';

    vm.createContext(ctx);
    vm.runInContext(inline, ctx, { filename: 'pinterest-inline.js' });

    return { app: ctx.__app, window, els, store, deleted, writes, fetches, localStorage };
}

(async () => {
    /* 1. A Kindle with no local token uses the connection saved on the account. */
    {
        const t = boot({ uid: 'U1', ua: KINDLE_UA });
        t.store[DOC] = { accessToken: 'CLOUD_TOKEN', refreshToken: 'CLOUD_REFRESH', expiry: Date.now() + 86400000 };
        t.window.onload();
        await sleep(60);

        assert.strictEqual(t.app.token, 'CLOUD_TOKEN', 'must adopt the account token');
        assert.strictEqual(t.app.refreshToken, 'CLOUD_REFRESH', 'must adopt the account refresh token');
        assert.strictEqual(t.localStorage.getItem('pinterest_access_token'), 'CLOUD_TOKEN', 'must mirror into local storage');
        assert.strictEqual(t.els['login-view'].style.display, 'none', 'must open the connected app');
        assert(!t.fetches.some(f => f.url.indexOf('/oauth') >= 0), 'must not start another OAuth round-trip');
        console.log('  ok - Kindle restores the account connection without re-authorising');
    }

    /* 2. Kindle with nothing anywhere explains the blank-screen dead end. */
    {
        const t = boot({ uid: 'U1', ua: KINDLE_UA });
        t.window.onload();
        await sleep(60);

        assert.strictEqual(t.els['login-view'].style.display, 'flex', 'must stay on the login view');
        assert.strictEqual(t.els['login-hint'].style.display, 'block', 'must show the e-ink hint');
        assert(/phone or computer/i.test(t.els['login-hint'].textContent), 'hint must point at a phone/PC');
        assert.strictEqual(t.els['login-status'].textContent, '', 'must clear the "checking" status');
        console.log('  ok - Kindle without a connection gets an actionable hint, not a dead button');
    }

    /* 3. Desktop keeps the normal connect flow (no e-ink hint). */
    {
        const t = boot({ uid: 'U1', ua: DESKTOP_UA });
        t.window.onload();
        await sleep(60);

        assert.notStrictEqual(t.els['login-hint'].style.display, 'block', 'desktop must not show the e-ink hint');
        assert.strictEqual(t.els['login-view'].style.display, 'flex', 'desktop stays on the login view');
        console.log('  ok - desktop sees no e-ink hint');
    }

    /* 4. A stale account token is refreshed, and the rotated refresh token saved. */
    {
        const t = boot({ uid: 'U1', ua: KINDLE_UA });
        t.store[DOC] = { accessToken: 'OLD', refreshToken: 'RT', expiry: Date.now() - 1000 };
        t.window.onload();
        await sleep(80);

        assert.strictEqual(t.app.token, 'REFRESHED', 'must refresh an expired account token');
        assert(t.fetches.some(f => f.url.indexOf('/refresh') >= 0), 'refresh must go through the worker');
        assert.strictEqual(t.store[DOC].refreshToken, 'RT2', 'rotated refresh token must reach the account copy');
        console.log('  ok - expired account token refreshes and the rotated token is saved');
    }

    /* 5. Authorising on a PC mirrors the connection to the account. */
    {
        const t = boot({ uid: 'U1', search: '?code=ABC&state=S1', local: { pinterest_oauth_state: 'S1' } });
        t.window.onload();
        await sleep(80);

        const doc = t.store[DOC];
        assert.strictEqual(t.app.token, 'NEW_TOKEN', 'exchange must still work locally');
        assert(doc && doc.accessToken === 'NEW_TOKEN', 'exchange must write the account copy');
        assert(doc.refreshToken === 'NEW_REFRESH', 'account copy must keep the refresh token');
        assert(typeof doc.expiry === 'number' && doc.expiry > Date.now(), 'account copy must record expiry');
        assert(!!t.localStorage.getItem('pinterest_cloud_stamp'), 'backfill marker must be written');
        console.log('  ok - connecting on a PC mirrors the token to pro_data/pinterest');
    }

    /* 6. Connections made before this change are migrated exactly once. */
    {
        const local = {
            pinterest_access_token: 'LOCAL',
            pinterest_refresh_token: 'LRT',
            pinterest_token_expiry: String(Date.now() + 86400000)
        };

        const first = boot({ uid: 'U1', local: Object.assign({}, local) });
        first.window.onload();
        await sleep(80);
        assert(first.store[DOC] && first.store[DOC].accessToken === 'LOCAL', 'existing connection must be backfilled');

        const stamp = first.localStorage.getItem('pinterest_cloud_stamp');
        const second = boot({ uid: 'U1', local: Object.assign({}, local, { pinterest_cloud_stamp: stamp }) });
        second.window.onload();
        await sleep(80);
        assert.strictEqual(second.writes.length, 0, 'must not write again while the marker matches');
        console.log('  ok - pre-existing connection backfills once, then stops writing');
    }

    /* 7. Disconnect removes the account copy too. */
    {
        const t = boot({
            uid: 'U1',
            local: {
                pinterest_access_token: 'LOCAL',
                pinterest_refresh_token: 'LRT',
                pinterest_token_expiry: String(Date.now() + 86400000)
            }
        });
        t.store[DOC] = { accessToken: 'LOCAL' };
        t.window.onload();
        await sleep(80);
        t.app.logout();
        await sleep(40);

        assert.strictEqual(t.localStorage.getItem('pinterest_access_token'), null, 'disconnect must clear the device');
        assert(t.deleted.indexOf(DOC) >= 0, 'disconnect must delete the account copy');
        assert(!t.store[DOC], 'account copy must be gone');
        assert.strictEqual(t.localStorage.getItem('pinterest_cloud_stamp'), null, 'marker must be cleared');
        console.log('  ok - Disconnect means everywhere');
    }

    /* 8. pro-gate fires its callback twice for cached Pro users. */
    {
        const t = boot({ uid: 'U1' });
        t.store[DOC] = { accessToken: 'ONLY_ONCE', refreshToken: 'R', expiry: Date.now() + 86400000 };
        t.window.onload();
        t.window.onload();
        await sleep(80);

        const pinLoads = t.fetches.filter(f => f.url.indexOf('/pins') >= 0).length;
        assert.strictEqual(t.app.token, 'ONLY_ONCE', 'the second callback must not reset the connection');
        assert(pinLoads <= 1, 'the second callback must not reload the app (' + pinLoads + ' loads)');
        console.log('  ok - double pro-gate callback is harmless');
    }

    /* 9. Signed out / no gate: no crash, no cloud writes, no hint on desktop. */
    {
        const t = boot({ gate: false, uid: null });
        t.window.onload();
        await sleep(60);

        assert.strictEqual(t.els['login-view'].style.display, 'flex', 'must still reach the login view');
        assert.strictEqual(t.writes.length, 0, 'must not attempt cloud writes without auth');
        console.log('  ok - no auth degrades to the login view without writing');
    }

    console.log('PASS - Pinterest cross-device connection');
})().catch((e) => {
    console.error('FAIL -', e.message);
    process.exit(1);
});
