const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function section(name) {
    console.log('  ' + name);
}

function makeEnv(options) {
    options = options || {};
    const store = new Map();
    const sessionStorage = {
        getItem: function (key) { return store.has(key) ? store.get(key) : null; },
        setItem: function (key, value) { store.set(key, String(value)); },
        removeItem: function (key) { store.delete(key); }
    };

    const state = { minted: 0, signIns: [], failNextSignIn: false };
    const window = { sessionStorage };
    const socialAuth = {
        currentUser: null,
        onAuthStateChanged: function (cb) {
            const self = this;
            setTimeout(function () { cb(self.currentUser); }, 0);
            return function () { };
        },
        signInWithCustomToken: function (token) {
            state.signIns.push(token);
            if (state.failNextSignIn) {
                state.failNextSignIn = false;
                return Promise.reject(new Error('invalid custom token'));
            }
            this.currentUser = { uid: options.socialUid || 'u1' };
            return Promise.resolve({ user: this.currentUser });
        }
    };

    const firebase = {
        functions: function () {
            return {
                httpsCallable: function () {
                    return function () {
                        state.minted++;
                        return Promise.resolve({ data: { token: 'tok-' + state.minted } });
                    };
                }
            };
        }
    };

    const context = {
        window: window,
        firebase: firebase,
        Promise: Promise,
        Date: Date,
        JSON: JSON,
        setTimeout: setTimeout,
        console: console
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'social-token-cache.js'), 'utf8'), context);

    return {
        window: window,
        store: store,
        socialAuth: socialAuth,
        state: state
    };
}

async function main() {
    section('first load mints and caches');
    {
        const env = makeEnv();
        const auth = { currentUser: { uid: 'u1' } };
        env.socialAuth.currentUser = null;
        const user = await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth);
        assert.strictEqual(user.uid, 'u1');
        assert.strictEqual(env.state.minted, 1, 'first load must call getSocialToken once');
        assert.strictEqual(env.state.signIns.length, 1, 'first load must sign in once');
        const cached = JSON.parse(env.store.get('rekindle_social_custom_token_v1'));
        assert.strictEqual(cached.uid, 'u1');
        assert.strictEqual(cached.token, 'tok-1');
        assert.ok(cached.mintedAt > 0);
    }

    section('restored social session + fresh cache skips the callable');
    {
        const env = makeEnv();
        const auth = { currentUser: { uid: 'u1' } };
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth); // prime cache

        env.socialAuth.currentUser = { uid: 'u1' };
        const user = await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth);
        assert.strictEqual(user.uid, 'u1');
        assert.strictEqual(env.state.minted, 1, 'fresh cache must not call getSocialToken again');
        assert.strictEqual(env.state.signIns.length, 1, 'restored session must not sign in again');
    }

    section('lost social session reuses the cached custom token');
    {
        const env = makeEnv();
        const auth = { currentUser: { uid: 'u1' } };
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth); // prime cache

        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth);
        assert.strictEqual(env.state.minted, 1, 'cached token must avoid the callable');
        assert.strictEqual(env.state.signIns.length, 2);
        assert.strictEqual(env.state.signIns[1], 'tok-1');
    }

    section('expired cache mints again');
    {
        const env = makeEnv();
        const auth = { currentUser: { uid: 'u1' } };
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth); // prime cache

        const entry = JSON.parse(env.store.get('rekindle_social_custom_token_v1'));
        entry.mintedAt = Date.now() - (51 * 60 * 1000);
        env.store.set('rekindle_social_custom_token_v1', JSON.stringify(entry));
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth);
        assert.strictEqual(env.state.minted, 2, 'expired cache must mint a new token');
    }

    section('a different main user never reuses the cache');
    {
        const env = makeEnv();
        const auth = { currentUser: { uid: 'u1' } };
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth); // prime cache for u1

        const auth2 = { currentUser: { uid: 'u2' } };
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth2, env.socialAuth);
        assert.strictEqual(env.state.minted, 2, 'uid mismatch must not reuse another user\'s token');
        assert.strictEqual(JSON.parse(env.store.get('rekindle_social_custom_token_v1')).uid, 'u2');
    }

    section('a rejected cached token is cleared and re-minted');
    {
        const env = makeEnv();
        const auth = { currentUser: { uid: 'u1' } };
        env.socialAuth.currentUser = null;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth); // prime cache

        env.socialAuth.currentUser = null;
        env.state.failNextSignIn = true;
        await env.window.rekindleEnsureSocialAuth(auth, env.socialAuth);
        assert.strictEqual(env.state.minted, 2, 'failed cached sign-in must fall back to a fresh token');
        assert.strictEqual(JSON.parse(env.store.get('rekindle_social_custom_token_v1')).token, 'tok-2');
    }

    section('signed out main auth rejects without calling the Function');
    {
        const env = makeEnv();
        await assert.rejects(
            env.window.rekindleEnsureSocialAuth({ currentUser: null }, env.socialAuth),
            /Not signed in/
        );
        assert.strictEqual(env.state.minted, 0);
    }

    console.log('PASS - social token cache');
}

main().catch(function (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
