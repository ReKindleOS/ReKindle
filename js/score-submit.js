/*
 * Server-verified game leaderboards — client half.
 * ---------------------------------------------------------------------------
 * Until 2026-10 every game wrote its own score straight to Firestore and the
 * rules only checked `score is number`. Pasting
 *
 *     db.collection('leaderboard_surfer').doc(uid).set({score: Infinity})
 *
 * into the console was enough for first place on every board.
 *
 * Now firestore.rules rejects all client writes to `leaderboard_*`. Games must
 * go through this helper, which:
 *
 *   1. on page load, calls `startGameRun` so the SERVER records when play began;
 *   2. on game over, calls `submitScore` with the run id and the claimed values.
 *
 * The server then bounds the claim by real elapsed time and a per-game maximum
 * (see firebase-functions/score-config.js). A client can still call the
 * callables directly, but cannot get more than its own play time is worth.
 *
 * Usage:
 *   <script src="js/score-submit.js" data-game="surfer"></script>
 *   window.RekindleScores.submit('leaderboard_surfer', { score: newScore });
 *
 * All failures are soft: the game keeps its local high score and the leaderboard
 * simply does not update. Nothing here may throw into the game loop.
 */
(function () {
    'use strict';

    var script = document.currentScript;
    var gameId = (script && script.getAttribute('data-game')) || '';
    if (!gameId) {
        // Fall back to the page name (`/surfer` or `/surfer.html`).
        var page = (window.location.pathname || '').split('/').pop() || '';
        gameId = page.replace(/\.html?$/i, '');
    }

    var authRef = null;
    var functionsRef = null;
    var runId = null;
    var runPromise = null;
    var uid = null;
    var started = false;

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[scores]');
            console.warn.apply(console, args);
        } catch (e) { /* ignore */ }
    }

    function getFunctions() {
        if (functionsRef) return functionsRef;
        if (!window.firebase || typeof window.firebase.functions !== 'function') return null;
        try {
            functionsRef = window.firebase.functions();
        } catch (e) {
            return null;
        }
        return functionsRef;
    }

    function callable(name, payload) {
        var fn = getFunctions();
        if (!fn) return Promise.reject(new Error('firebase-functions not loaded'));
        return fn.httpsCallable(name)(payload).then(function (res) {
            return res && res.data ? res.data : {};
        });
    }

    function beginRun() {
        if (runPromise) return runPromise;
        if (!uid || !gameId) return Promise.resolve(null);

        runPromise = callable('startGameRun', { game: gameId }).then(function (res) {
            if (res && res.ok && res.runId) {
                runId = res.runId;
                return runId;
            }
            runPromise = null;
            return null;
        }).catch(function (e) {
            // Leave runPromise null so a later submit can retry.
            runPromise = null;
            log('could not start run:', e && e.message ? e.message : e);
            return null;
        });

        return runPromise;
    }

    function sanitize(data) {
        var out = {};
        if (!data || typeof data !== 'object') return out;
        Object.keys(data).forEach(function (key) {
            if (key === 'username' || key === 'timestamp' || key === 'verified') return;
            var value = data[key];
            if (typeof value === 'number') {
                if (isFinite(value)) out[key] = value;
                return;
            }
            if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
                out[key] = value;
                return;
            }
            if (typeof value === 'object') out[key] = value; // stats blobs (server size-checks)
        });
        return out;
    }

    function send(collection, data, attempt) {
        var payload = {
            game: gameId,
            collection: collection,
            runId: runId,
            data: sanitize(data)
        };
        return callable('submitScore', payload).then(function (res) {
            if (res && res.accepted) return res;

            // A run can be replaced (page reloaded in another tab) or expire.
            // Refresh it once and try again; the server still bounds the value.
            if (attempt === 1 && res && (res.reason === 'no-run' || res.reason === 'stale-run' || res.reason === 'run-expired')) {
                runId = null;
                runPromise = null;
                return beginRun().then(function (id) {
                    if (!id) return res;
                    return send(collection, data, 2);
                });
            }
            return res || { accepted: false, reason: 'unknown' };
        });
    }

    // ---- Burst coalescing (2026-11) ---------------------------------------
    // A console loop such as
    //   for (i = 0; i <= 66; i += 2) await RekindleScores.submit('leaderboard_surfer', { score: i * 10000 })
    // used to cost one function invocation and one Firestore transaction per
    // iteration. No game in the app submits more than once per finished game,
    // so anything inside this window is a burst: keep only the newest payload
    // per collection and send it once, when the window closes. The dropped
    // calls never reach the network, so this *reduces* usage; it is not a
    // security boundary (the console can call the callable directly) — the
    // server-side anchoring in firebase-functions/scores.js is.
    var MIN_SUBMIT_GAP_MS = 4000;
    var lastSentAt = 0;
    var pending = {};
    var flushTimer = null;
    var flushing = false;

    function pendingCount() {
        var n = 0;
        for (var key in pending) {
            if (Object.prototype.hasOwnProperty.call(pending, key)) n++;
        }
        return n;
    }

    function queue(collection, data) {
        var slot = pending[collection];
        if (!slot) {
            slot = pending[collection] = { data: null };
        }
        slot.data = sanitize(data);
    }

    function scheduleFlush() {
        if (flushTimer || flushing || !pendingCount()) return;
        var wait = MIN_SUBMIT_GAP_MS - (Date.now() - lastSentAt);
        if (wait <= 0) {
            flushAll();
            return;
        }
        flushTimer = window.setTimeout(function () {
            flushTimer = null;
            flushAll();
        }, wait);
    }

    // Different collections are separate boards (hanoi_3 … hanoi_7), so they
    // are sent back to back; the gap only governs repeats of the same burst.
    function flushAll() {
        if (flushing) return;
        var collections = [];
        for (var key in pending) {
            if (Object.prototype.hasOwnProperty.call(pending, key)) collections.push(key);
        }
        if (!collections.length) return;

        flushing = true;
        var index = 0;

        function step() {
            if (index >= collections.length) {
                flushing = false;
                scheduleFlush();
                return;
            }
            var collection = collections[index++];
            var slot = pending[collection];
            delete pending[collection];
            if (!slot) { step(); return; }
            lastSentAt = Date.now();

            beginRun().then(function () {
                if (!runId) return { accepted: false, reason: 'no-run' };
                return send(collection, slot.data, 1);
            }).catch(function (e) {
                log('submit failed:', e && e.message ? e.message : e);
                return { accepted: false, reason: 'error' };
            }).then(step);
        }

        step();
    }

    // Resolves as soon as the payload is queued, not when the network call
    // finishes. That matters for the console loop above: if submit() only
    // resolved after a throttled send, `await` would turn the burst into one
    // invocation every 4s (still 34 calls). Resolving immediately lets the
    // loop finish, so only the newest payload is ever sent. No caller reads
    // the result; every game treats a submission as fire-and-forget.
    function submit(collection, data) {
        if (!uid || !collection) return Promise.resolve({ accepted: false, reason: 'signed-out' });
        queue(collection, data);
        scheduleFlush();
        return Promise.resolve({ accepted: true, queued: true });
    }

    function attach() {
        if (started) return;
        if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) return;
        if (typeof window.firebase.auth !== 'function') return;
        started = true;
        try {
            authRef = window.firebase.auth();
        } catch (e) {
            started = false;
            return;
        }
        authRef.onAuthStateChanged(function (user) {
            uid = user ? user.uid : null;
            if (uid) {
                beginRun();
            } else {
                runId = null;
                runPromise = null;
            }
        });
    }

    // The page itself initialises Firebase inside its own script (often on
    // pageshow), so poll briefly for the default app to appear.
    var waits = 0;
    (function waitForFirebase() {
        attach();
        if (started || waits++ > 150) return; // ~15s, then give up quietly
        window.setTimeout(waitForFirebase, 100);
    })();

    window.RekindleScores = {
        game: gameId,
        begin: beginRun,
        submit: submit
    };
})();
