/*
 * Leaderboard exploit regression test.
 *
 * Run: node scripts/test-scores.js
 *
 * Covers the 2026-11 report: a console loop calling
 *
 *   for (let i = 0; i <= 66; i += 2) await RekindleScores.submit('leaderboard_surfer', { score: i * 10000 })
 *
 * The old server credited `rate * (now - runStart)` on every call while
 * `previousBest` already held the last claim, so each submit re-earned the
 * same seconds. After an idle tab that let the loop walk the score up to the
 * absolute maximum. Two layers now stop it, both at zero extra Firebase
 * operations:
 *
 *   1. js/score-submit.js coalesces a burst into one call per collection per
 *      4s window (fewer invocations than before, never more).
 *   2. firebase-functions/scores.js anchors the time credit at
 *      max(runStart, lastSubmitAt), a field the transaction already reads.
 *
 * The Firestore/admin layer is stubbed in memory; no project credentials are
 * used and nothing is written to Firebase.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fnDir = path.join(__dirname, '..', 'firebase-functions');
const clock = { now: 1700000000000 };
const realNow = Date.now;
Date.now = () => clock.now;

/* ------------------------------------------------------------------ *
 * In-memory Firestore / RTDB / logger stubs for scores.js
 * ------------------------------------------------------------------ */
const store = new Map();
const auditWrites = [];

function hydrate(value) {
    if (value && typeof value === 'object' && value.__serverTimestamp) {
        const ms = clock.now;
        return { toMillis: () => ms };
    }
    return value;
}

class DocRef {
    constructor(p) { this.path = p; }
    async get() {
        const value = store.get(this.path);
        return { exists: value !== undefined, data: () => value };
    }
    __write(data, opts) {
        const prev = (opts && opts.merge && store.get(this.path)) || {};
        const next = {};
        Object.keys(prev).forEach((k) => { next[k] = prev[k]; });
        Object.keys(data).forEach((k) => { next[k] = hydrate(data[k]); });
        store.set(this.path, next);
    }
}

class CollectionRef {
    constructor(name) { this.name = name; }
    doc(id) { return new DocRef(this.name + '/' + id); }
    async add(data) {
        auditWrites.push({ path: this.name, data: data });
        return { id: 'audit-' + auditWrites.length };
    }
}

const fakeDb = {
    collection(name) { return new CollectionRef(name); },
    async runTransaction(fn) {
        const queued = [];
        const tx = {
            get(ref) { return ref.get(); },
            set(ref, data, opts) { queued.push([ref, data, opts]); }
        };
        const result = await fn(tx);
        queued.forEach((entry) => entry[0].__write(entry[1], entry[2]));
        return result;
    }
};

const fakeAdmin = {
    firestore: Object.assign(() => fakeDb, {
        FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) }
    }),
    database: () => ({
        ref: () => ({ get: async () => ({ val: () => 'Tester' }) })
    })
};

class HttpsError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/* Stub by request string through Module._load, not require.resolve.
 *
 * CI runs `npm ci` at the repository root only, so `firebase-functions/` has
 * no node_modules on the runner: `firebase-functions/logger` and
 * `firebase-functions/v2/https` cannot be resolved even though they resolve
 * on a dev machine that installed that package. Resolving first made this
 * test pass locally and fail the deploy with MODULE_NOT_FOUND (run #385,
 * 2026-11-03, "Static audit + unit tests"). Interception never touches the
 * filesystem, so the test stays hermetic with root dependencies alone.
 */
const Module = require('module');
const stubs = {
    'firebase-admin': fakeAdmin,
    'firebase-functions/logger': { warn() {}, info() {}, error() {}, debug() {} },
    'firebase-functions/v2/https': { HttpsError }
};
const realModuleLoad = Module._load;
Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
        return stubs[request];
    }
    return realModuleLoad.apply(this, arguments);
};

const { startGameRun, submitScore } = require(path.join(fnDir, 'scores.js'));

const auth = { uid: 'u1', token: { email: 'tester@example.com' } };
const GAME = 'surfer';
const BOARD = 'leaderboard_surfer';

function reset() {
    store.clear();
    auditWrites.length = 0;
}

async function start() {
    const res = await startGameRun({ auth: auth, data: { game: GAME } });
    assert.ok(res && res.ok && res.runId, 'startGameRun must return a run id');
    return res.runId;
}

function submit(runId, score) {
    return submitScore({
        auth: auth,
        data: { game: GAME, collection: BOARD, runId: runId, data: { score: score } }
    });
}

function best() {
    const doc = store.get(BOARD + '/u1');
    return doc && typeof doc.score === 'number' ? doc.score : null;
}

(async () => {
    /* ---- 1. The reported loop on a fresh page ------------------------- */
    reset();
    let runId = await start();
    clock.now += 500; // half a second of "play"
    let accepted = 0;
    for (let i = 0; i <= 66; i += 2) {
        const res = await submit(runId, i * 10000);
        if (res.accepted) accepted++;
    }
    assert.ok(best() === null || best() < 10000,
        'fresh-run burst must not bank 660000 (got ' + best() + ')');
    assert.ok(accepted <= 1, 'at most the first value in a fresh-run burst is believable');

    /* ---- 2. Idle tab, then the loop ---------------------------------- */
    // The old code handed the first submit 30 minutes of credit, and then
    // re-credited those same 30 minutes on every following submit because
    // `previousBest` had already absorbed them. Anchoring stops the replay:
    // only one claim can use the idle window.
    reset();
    runId = await start();
    clock.now += 30 * 60 * 1000;
    const idleResults = [];
    for (let i = 0; i <= 66; i += 2) {
        idleResults.push(await submit(runId, i * 10000));
    }
    assert.ok(best() === null || best() < 10000,
        'idle tab + loop must not climb above the first claim (got ' + best() + ')');
    assert.ok(idleResults.filter((r) => r.accepted).length <= 1,
        'only the first claim may spend the idle window');

    /* ---- 2b. Existing best + idle + loop: only ONE claim can spend it - */
    // With prev=50000 the first values are simply not better, so they do not
    // move the anchor. The first improving claim (60000) can still spend the
    // 30 idle minutes — that is the documented residual — but every later
    // value in the same burst gets ~0 new credit, so 660000 cannot stick.
    reset();
    store.set(BOARD + '/u1', { score: 50000 });
    runId = await start();
    clock.now += 30 * 60 * 1000;
    let improved = 0;
    for (let i = 0; i <= 66; i += 2) {
        const r = await submit(runId, i * 10000);
        if (r.accepted) improved++;
    }
    assert.strictEqual(best(), 60000, 'only the first improving claim can spend the idle window');
    assert.strictEqual(improved, 1, 'the rest of the burst must be rejected');

    /* ---- 3. Honest play still works ---------------------------------- */
    reset();
    runId = await start();
    clock.now += 120 * 1000;
    let res = await submit(runId, 30000);
    assert.strictEqual(res.accepted, true, 'a 2-minute run at 30k must be accepted');
    assert.strictEqual(best(), 30000);

    clock.now += 100 * 1000;
    res = await submit(runId, 60000);
    assert.strictEqual(res.accepted, true, 'a later better run must be accepted');
    assert.strictEqual(best(), 60000);

    /* ---- 4. A rapid second claim gets only the time since the last ---- */
    clock.now += 1000;
    res = await submit(runId, 70000);
    assert.strictEqual(res.accepted, false, 'a 1s-later jump must be rejected');
    assert.strictEqual(res.reason, 'implausible');
    assert.strictEqual(best(), 60000);

    /* ---- 5. Reload within 2s reuses the run (no clock reset) --------- */
    reset();
    runId = await start();
    clock.now += 1000;
    const again = await start();
    assert.strictEqual(again, runId, 'a quick reload must reuse the open run');

    /* ---- 6. Unknown game / collection still rejected ------------------ */
    reset();
    res = await submitScore({
        auth: auth,
        data: { game: 'surfer', collection: 'leaderboard_nope', runId: 'x'.repeat(10), data: { score: 1 } }
    });
    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.reason, 'invalid-collection');

    Date.now = realNow;

    /* ------------------------------------------------------------------ *
     * Client coalescing: the same loop must reach the network twice,
     * not 35 times. Uses fake timers so the test is instant.
     * ------------------------------------------------------------------ */
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'score-submit.js'), 'utf8');
    const timers = [];
    let clientNow = 1700000000000;
    const calls = [];

    const windowObj = {
        location: { pathname: '/surfer' },
        setTimeout(fn, ms) {
            timers.push({ at: clientNow + ms, fn: fn });
            return timers.length;
        },
        clearTimeout() {}
    };

    const sandbox = {
        Promise: Promise,
        Date: { now: () => clientNow },
        console: { warn() {}, log() {}, error() {} },
        window: windowObj,
        document: { currentScript: { getAttribute: () => 'surfer' } }
    };

    windowObj.firebase = {
        apps: [{}],
        auth: () => ({
            onAuthStateChanged(cb) { cb({ uid: 'u1', email: 'a@b' }); }
        }),
        functions: () => ({
            httpsCallable: (name) => (payload) => {
                calls.push({ name: name, payload: payload });
                const data = name === 'startGameRun'
                    ? { ok: true, runId: 'run-1' }
                    : { accepted: !!payload && payload.data && payload.data.score === 0, reason: 'implausible' };
                return Promise.resolve({ data: data });
            }
        })
    };
    windowObj.window = windowObj;

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'score-submit.js' });

    async function drain() {
        for (let i = 0; i < 5; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    async function advance(ms) {
        clientNow += ms;
        let guard = 0;
        while (guard++ < 100) {
            const due = timers.filter((t) => t.at <= clientNow);
            if (!due.length) break;
            const next = due[0];
            timers.splice(timers.indexOf(next), 1);
            next.fn();
            await drain();
        }
        await drain();
    }

    await drain(); // startGameRun from auth

    const scores = windowObj.RekindleScores;
    const burst = [];
    for (let i = 0; i <= 66; i += 2) {
        burst.push(scores.submit(BOARD, { score: i * 10000 }));
    }
    await drain();
    await advance(4001);
    await Promise.all(burst);

    const submits = calls.filter((c) => c.name === 'submitScore');
    assert.ok(submits.length <= 2,
        'a 34-call burst must coalesce to at most 2 submitScore calls (got ' + submits.length + ')');
    assert.strictEqual(submits[0].payload.data.score, 0, 'first flush sends the first value');
    assert.strictEqual(submits[submits.length - 1].payload.data.score, 660000,
        'closing flush sends the newest value and drops the middle ones');

    const before = calls.length;
    const p = scores.submit(BOARD, { score: 5 });
    await drain();
    await advance(4001);
    await p;
    assert.ok(calls.length > before, 'a submit after the window still reaches the server');

    /* ---- The exploit as written: `await` inside the loop --------------- */
    // Early resolution is what makes this collapse. If submit() waited for
    // the throttled send, `await` would serialise the loop into 34 calls at
    // one per window. Instead it queues and resolves, so the loop finishes
    // instantly and only the newest payload is sent.
    const beforeLoop = calls.filter((c) => c.name === 'submitScore').length;
    const loopStart = clientNow;
    for (let i = 0; i <= 66; i += 2) {
        await scores.submit(BOARD, { score: i * 10000 });
    }
    assert.strictEqual(clientNow, loopStart, 'the awaited loop must not block on the 4s window');
    await drain();
    await advance(4001);
    const loopCalls = calls.filter((c) => c.name === 'submitScore').length - beforeLoop;
    assert.ok(loopCalls <= 2,
        'the awaited loop must still collapse to at most 2 calls (got ' + loopCalls + ')');

    console.log('PASS - leaderboard burst exploit bounded at zero extra Firebase ops');
})().catch((e) => {
    Date.now = realNow;
    console.error(e);
    process.exit(1);
});
