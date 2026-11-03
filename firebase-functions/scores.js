/**
 * Server-authoritative leaderboard writes.
 *
 * Previously every game wrote its own score straight to Firestore:
 *
 *     db.collection('leaderboard_surfer').doc(uid).set({ score: <anything> })
 *
 * and firestore.rules only checked `score is number`, so anyone could paste one
 * line into the console and take first place with Infinity / 1e67 / whatever.
 *
 * Now the browser cannot write a leaderboard document at all. It must:
 *   1. call `startGameRun` when the game page opens (server records the time),
 *   2. call `submitScore` when the game ends.
 *
 * The server then decides whether the claimed value is believable:
 *
 *     allowed = min(absoluteMax, startingPoint + rate * secondsSinceLastAccept)
 *     startingPoint = max(previousBest, base)
 *
 * where `secondsSinceLastAccept` is measured from the later of the run start
 * and the run's `lastSubmitAt` (2026-11). Using `startedAt` on every call
 * replayed the whole run's clock against `previousBest`, so a burst of
 * submissions could multiply the same idle minutes into the maximum. The
 * anchor lives on the run document the transaction already reads, so the fix
 * costs no extra reads, writes or invocations.
 *
 * so a value can only grow as fast as a (very good) human could actually play.
 * `base` is a floor, not a per-run bonus: adding it every time would let a
 * reload farm it (fresh run → elapsed 0 → claim prev + base → repeat).
 * The absolute max is the last line of defence and makes "infinity" impossible.
 *
 * Exports are plain async handlers; index.js wraps them in onCall(callOptions, …).
 */

const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { HttpsError } = require('firebase-functions/v2/https');
const { COLLECTIONS, OPAQUE_MAX_BYTES, isValidUsername } = require('./score-config');

const RUN_COLLECTION = 'game_runs';
const AUDIT_COLLECTION = 'score_audit';
const RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;     // a tab older than a day is not a run
const RUN_MAX_ELAPSED_S = 6 * 60 * 60;          // never award more than 6h of play credit
const USERNAME_TTL_MS = 5 * 60 * 1000;          // cache RTDB username lookups
const AUDIT_THROTTLE_MS = 60 * 1000;            // max one audit row per user per minute
const usernameCache = new Map();
const auditLast = new Map();
const KNOWN_GAMES = Object.keys(COLLECTIONS).map((c) => COLLECTIONS[c].game)
    .filter((g, i, all) => all.indexOf(g) === i);

function db() {
    return admin.firestore();
}

function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
}

function sanitizeKey(key) {
    return typeof key === 'string' && key.length <= 64 && !key.startsWith('__') && key.indexOf('/') === -1;
}

/**
 * Opaque state blobs (wordle / spellbound save data) are the player's own
 * progress. They never affect ranking, but they still must be bounded JSON.
 */
function isOpaqueValue(value) {
    if (value === null || typeof value !== 'object') return false;
    let json;
    try {
        json = JSON.stringify(value);
    } catch (e) {
        return false; // circular / BigInt / etc.
    }
    return typeof json === 'string' && json.length <= OPAQUE_MAX_BYTES;
}

async function logAudit(entry) {
    // Best-effort: never let auditing break a submission, and never let a
    // cheater flood the collection — one row per user per minute is enough.
    const last = auditLast.get(entry.uid) || 0;
    if (Date.now() - last < AUDIT_THROTTLE_MS) return;
    if (auditLast.size > 5000) auditLast.clear();
    auditLast.set(entry.uid, Date.now());
    try {
        await db().collection(AUDIT_COLLECTION).add(
            Object.assign({ at: admin.firestore.FieldValue.serverTimestamp() }, entry)
        );
    } catch (e) {
        logger.warn('score_audit write failed', e);
    }
}

async function resolveUsername(uid, token) {
    const cached = usernameCache.get(uid);
    if (cached && Date.now() - cached.at < USERNAME_TTL_MS) return cached.name;
    let name = null;
    try {
        const snap = await admin.database().ref('users_public/' + uid + '/username').get();
        const value = snap.val();
        if (isValidUsername(value)) name = value;
    } catch (e) {
        logger.warn('resolveUsername RTDB lookup failed', e);
    }
    if (!name) {
        const email = (token && token.email) || '';
        const prefix = String(email).split('@')[0];
        name = isValidUsername(prefix) ? prefix : 'User_' + uid.slice(0, 5);
    }
    if (usernameCache.size > 5000) usernameCache.clear();
    usernameCache.set(uid, { name: name, at: Date.now() });
    return name;
}

function gameFromRequest(data) {
    const game = data && data.game;
    if (typeof game !== 'string' || !/^[a-z0-9_]{1,40}$/.test(game)) {
        return null;
    }
    return game;
}

/**
 * startGameRun({ game }) -> { runId }
 *
 * Called once when a game page loads. Each run is scoped to (user, game) and
 * replaces any previous run for that pair, so a player cannot keep a stale
 * "started 10 years ago" token around to unlock unlimited scores.
 */
async function startGameRun(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const game = gameFromRequest(request.data);
    if (!game || KNOWN_GAMES.indexOf(game) === -1) {
        return { ok: false, reason: 'invalid-game' };
    }

    const runRef = db().collection(RUN_COLLECTION).doc(uid + '_' + game);
    const runId = require('crypto').randomUUID();

    await db().runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (snap.exists) {
            const existing = snap.data() || {};
            const startedAt = existing.startedAt;
            // Re-use a run created moments ago (page reload / double init) so a
            // refresh does not reset elapsed time back to zero.
            if (existing.runId && startedAt && typeof startedAt.toMillis === 'function' &&
                Date.now() - startedAt.toMillis() < 2000) {
                return;
            }
        }
        tx.set(runRef, {
            uid: uid,
            game: game,
            runId: runId,
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSubmitAt: 0
        });
    });

    const after = await runRef.get();
    return { ok: true, runId: after.exists ? after.data().runId : runId };
}

/**
 * submitScore({ game, collection, runId, data }) -> { accepted, reason?, best? }
 *
 * `data` is the same object the game used to write: { score } / { moves } /
 * { score, stats } / etc. username and timestamp are ignored — the server
 * supplies both.
 */
async function submitScore(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const payload = request.data || {};
    const game = gameFromRequest(payload);
    const collection = payload.collection;
    const runId = payload.runId;
    const incoming = payload.data;

    if (!game || typeof collection !== 'string' || !COLLECTIONS[collection]) {
        return { accepted: false, reason: 'invalid-collection' };
    }
    const config = COLLECTIONS[collection];
    if (config.game !== game) {
        return { accepted: false, reason: 'invalid-collection' };
    }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return { accepted: false, reason: 'invalid-data' };
    }
    if (typeof runId !== 'string' || runId.length < 8 || runId.length > 80) {
        return { accepted: false, reason: 'no-run' };
    }

    const fields = config.fields || {};
    const opaque = config.opaque || [];

    // ---- Build and validate the update before touching Firestore -------------
    const numeric = {};
    const blobs = {};
    let invalid = null;

    Object.keys(incoming).forEach((key) => {
        if (!sanitizeKey(key)) return;
        if (fields[key]) {
            const value = incoming[key];
            const rule = fields[key];
            if (!isFiniteNumber(value) || (!rule.float && !Number.isInteger(value)) ||
                value < rule.min || value > rule.max) {
                // A ranking field was supplied with an impossible value. Treat
                // the whole submission as an attack instead of silently
                // ignoring it — it gets logged to score_audit below.
                if (!invalid) invalid = { field: key, claimed: String(value), reason: 'out-of-range' };
                return;
            }
            numeric[key] = value;
        } else if (opaque.indexOf(key) !== -1 && isOpaqueValue(incoming[key])) {
            blobs[key] = incoming[key];
        }
        // Anything else is dropped: clients cannot add arbitrary fields.
    });

    if (invalid) {
        await logAudit({
            type: 'invalid_score',
            uid: uid,
            game: game,
            collection: collection,
            field: invalid.field,
            claimed: invalid.claimed
        });
        return { accepted: false, reason: 'implausible', detail: invalid };
    }

    const runRef = db().collection(RUN_COLLECTION).doc(uid + '_' + game);
    const docRef = db().collection(collection).doc(uid);
    const username = await resolveUsername(uid, request.auth.token);

    const result = await db().runTransaction(async (tx) => {
        const runSnap = await tx.get(runRef);
        if (!runSnap.exists) {
            return { accepted: false, reason: 'no-run' };
        }
        const run = runSnap.data() || {};
        if (run.game !== game || run.runId !== runId) {
            return { accepted: false, reason: 'stale-run' };
        }
        const startedAt = run.startedAt;
        if (!startedAt || typeof startedAt.toMillis !== 'function') {
            return { accepted: false, reason: 'stale-run' };
        }
        const nowMs = Date.now();
        const ageMs = nowMs - startedAt.toMillis();
        if (ageMs < 0 || ageMs > RUN_MAX_AGE_MS) {
            return { accepted: false, reason: 'run-expired' };
        }
        // Credit only the time since the LAST accepted submission, not since
        // the run opened. `prev` already contains every second credited so
        // far; re-adding `now - startedAt` to it replayed the same clock on
        // every call. A console loop of 34 submits could therefore turn a few
        // idle minutes into the absolute maximum (2026-11 report). The anchor
        // is the same run document that is already read here, so this costs no
        // extra reads, writes or function invocations.
        const lastAt = isFiniteNumber(run.lastSubmitAt) && run.lastSubmitAt > 0 ? run.lastSubmitAt : 0;
        const anchorMs = Math.max(startedAt.toMillis(), lastAt);
        const sinceMs = Math.max(0, nowMs - anchorMs);
        const elapsed = Math.min(RUN_MAX_ELAPSED_S, sinceMs / 1000);
        const docSnap = await tx.get(docRef);
        const previous = docSnap.exists ? (docSnap.data() || {}) : {};

        const updates = {};
        let rejected = null;

        Object.keys(numeric).forEach((key) => {
            const rule = fields[key];
            const claimed = numeric[key];
            const prev = isFiniteNumber(previous[key]) ? previous[key] : null;

            if (rule.dir === 'lower') {
                // Smaller is better: no time credit needed (you cannot "grind"
                // your way to fewer moves), the absolute min/max above guard it.
                if (prev === null || claimed < prev) {
                    updates[key] = claimed;
                }
                return;
            }

            // `base` is a floor, not a bonus: it must not be added to the
            // previous best on every run, or a reload would farm it.
            const startingPoint = Math.max(prev === null ? 0 : prev, rule.base);
            const allowance = startingPoint + rule.rate * elapsed;
            const maxAllowed = Math.min(rule.max, allowance);
            if (claimed > maxAllowed) {
                rejected = { field: key, claimed: claimed, allowed: maxAllowed };
                return;
            }
            if (prev === null || claimed > prev) {
                updates[key] = claimed;
            }
        });

        if (rejected) {
            return { accepted: false, reason: 'implausible', detail: rejected };
        }

        Object.keys(blobs).forEach((key) => {
            updates[key] = blobs[key];
        });

        if (Object.keys(updates).length === 0) {
            return { accepted: false, reason: 'not-better' };
        }

        updates.username = username;
        updates.timestamp = admin.firestore.FieldValue.serverTimestamp();
        updates.verified = true;

        tx.set(docRef, updates, { merge: true });
        tx.set(runRef, { lastSubmitAt: nowMs }, { merge: true });

        return { accepted: true, best: updates };
    });

    if (!result.accepted && result.reason === 'implausible') {
        const d = result.detail || {};
        await logAudit({
            type: 'implausible_score',
            uid: uid,
            game: game,
            collection: collection,
            field: d.field,
            claimed: d.claimed,
            allowed: d.allowed
        });
    }

    return result;
}

module.exports = { startGameRun, submitScore };
