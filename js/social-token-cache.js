/*
 * Shared social-project sign-in with a short-lived sessionStorage cache.
 *
 * Why this exists (2026-10-25 usage audit):
 * `getSocialToken` was the most-invoked Cloud Function (~126k/month) because
 * every social page load minted a fresh social custom token and signed in
 * again, even when the social Auth session was already restored and had been
 * minted seconds earlier in the same tab.
 *
 * Behaviour:
 *   1. If the social session restored and a token minted in this tab is less
 *      than TOKEN_TTL_MS old, reuse the session (no Function call).
 *   2. If the social session did not survive but the cached custom token is
 *      still fresh, sign in with it (one Auth request, no Function call).
 *   3. Otherwise call `getSocialToken`, sign in, and cache the token.
 *
 * The cache is sessionStorage, so it is per-tab and dies with the tab. It is
 * keyed by the main-project uid; a different signed-in user never reuses it.
 * Claims (pro/moderator/ageVerified) can be up to TOKEN_TTL_MS stale, the same
 * order as a Firebase ID token lifetime. Do not increase TTL without accepting
 * that staleness.
 *
 * Load before the page script: <script src="js/social-token-cache.js?v=1"></script>
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'rekindle_social_custom_token_v1';
    var TOKEN_TTL_MS = 50 * 60 * 1000; // Firebase custom tokens expire after 1h.
    var RESTORE_WAIT_MS = 1000;       // Firebase Auth restore is normally <200ms.

    function getStorage() {
        try {
            return window.sessionStorage;
        } catch (e) {
            return null;
        }
    }

    function readCache(uid) {
        var store = getStorage();
        if (!store) return null;
        try {
            var raw = store.getItem(STORAGE_KEY);
            if (!raw) return null;
            var entry = JSON.parse(raw);
            if (!entry || entry.uid !== uid || typeof entry.token !== 'string') return null;
            if (!entry.mintedAt || (Date.now() - entry.mintedAt) > TOKEN_TTL_MS) return null;
            return entry;
        } catch (e) {
            return null;
        }
    }

    function writeCache(uid, token) {
        var store = getStorage();
        if (!store) return;
        try {
            store.setItem(STORAGE_KEY, JSON.stringify({
                uid: uid,
                token: token,
                mintedAt: Date.now()
            }));
        } catch (e) {
            // Quota/private mode: the next page load simply mints again.
        }
    }

    function clearCache() {
        var store = getStorage();
        if (!store) return;
        try {
            store.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore */ }
    }

    // Wait for Firebase Auth to restore the social session. The first
    // onAuthStateChanged callback fires after restore, so a null there means
    // there is no session (not "still loading").
    function waitForSocialUser(socialAuth) {
        if (socialAuth.currentUser) return Promise.resolve(socialAuth.currentUser);
        return new Promise(function (resolve) {
            var settled = false;
            var unsubscribe = function () {};

            function finish(user) {
                if (settled) return;
                settled = true;
                try { unsubscribe(); } catch (e) { /* ignore */ }
                resolve(user || null);
            }

            try {
                unsubscribe = socialAuth.onAuthStateChanged(
                    function (user) { finish(user); },
                    function () { finish(null); }
                );
            } catch (e) {
                finish(null);
                return;
            }

            // Defensive: never block a page forever if auth never calls back.
            setTimeout(function () { finish(socialAuth.currentUser); }, RESTORE_WAIT_MS);
        });
    }

    function mintSocialToken() {
        var callable = firebase.functions().httpsCallable('getSocialToken');
        return callable({}).then(function (result) {
            var token = result && result.data && result.data.token;
            if (!token) throw new Error('getSocialToken returned no token');
            return token;
        });
    }

    /**
     * Ensure the social project is signed in as the current main-project user.
     * @param {Object} auth       main-project firebase.auth()
     * @param {Object} socialAuth secondary social-app auth()
     * @returns {Promise<Object>} the social auth user
     */
    window.rekindleEnsureSocialAuth = function (auth, socialAuth) {
        if (!auth || !socialAuth) {
            return Promise.reject(new Error('Social auth is not initialised'));
        }
        var mainUser = auth.currentUser;
        if (!mainUser) {
            return Promise.reject(new Error('Not signed in'));
        }

        return waitForSocialUser(socialAuth).then(function (restored) {
            var cached = readCache(mainUser.uid);

            // Common case: the tab already has a matching social session and a
            // recently minted token, so the Function call is redundant.
            if (restored && restored.uid === mainUser.uid && cached) {
                return restored;
            }

            // The social session did not survive (cache wipe/new tab) but the
            // custom token is still valid: one Auth request instead of a callable.
            if (cached) {
                return socialAuth.signInWithCustomToken(cached.token).then(function (cred) {
                    return (cred && cred.user) || socialAuth.currentUser;
                })['catch'](function () {
                    clearCache();
                    return null;
                });
            }

            return null;
        }).then(function (user) {
            if (user) return user;

            return mintSocialToken().then(function (token) {
                return socialAuth.signInWithCustomToken(token).then(function (cred) {
                    writeCache(mainUser.uid, token);
                    return (cred && cred.user) || socialAuth.currentUser;
                });
            });
        });
    };

    window.rekindleClearSocialTokenCache = clearCache;
})();
