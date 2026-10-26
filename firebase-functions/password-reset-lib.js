/**
 * Pure helpers for the signed-in "I forgot my password" reset.
 *
 * Deliberately free of firebase-admin / firebase-functions imports so
 * `scripts/test-password-reset.js` can exercise the password policy, the
 * typed-username confirmation and the rate-limit maths without credentials.
 * The I/O lives in `password-reset.js`.
 *
 * Design rules (keep these true):
 *  - The caller must be signed in. This flow EXISTS for users who cannot prove
 *    knowledge of the current password, so the live session is the authority.
 *    Do not add a password/recent-login check here; do add guardrails instead
 *    (typed username, strict password policy, per-uid rate limit, audit log).
 *  - The password itself is never logged, echoed back or written to any
 *    database node. Only its length/policy result is inspected.
 *  - Rate-limit state is keyed by uid and lives in the primary RTDB under
 *    `password_reset_limits/{uid}` (clients are denied by rtdb-rules.json).
 *  - Audit entries live under `security_events/{uid}` and carry no secrets.
 */

'use strict';

// Firebase's own minimum is 6; the reset path is deliberately stricter because
// it is reachable without the current password.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Per-uid sliding window. Three changes in an hour is already generous for a
// human, and five in a day stops a script from making the change repeatedly.
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RESETS_PER_WINDOW = 3;
const MAX_RESETS_PER_DAY = 5;

// Keep the stored array small; the daily cap needs at most five entries and a
// little headroom covers clock skew.
const MAX_TRACKED_ATTEMPTS = 10;

// Tolerance for a device clock that is slightly ahead of the function host.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const PASSWORD_REASONS = {
    REQUIRED: 'password-required',
    TOO_SHORT: 'password-too-short',
    TOO_LONG: 'password-too-long',
    TOO_GUESSABLE: 'password-too-guessable'
};

function asPassword(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * Validate a proposed password without touching the account. Returns an empty
 * string when acceptable, otherwise one of PASSWORD_REASONS.
 */
function validateNewPassword(password, username) {
    const value = asPassword(password);
    if (!value.trim()) return PASSWORD_REASONS.REQUIRED;
    if (value.length < MIN_PASSWORD_LENGTH) return PASSWORD_REASONS.TOO_SHORT;
    if (value.length > MAX_PASSWORD_LENGTH) return PASSWORD_REASONS.TOO_LONG;

    const name = String(username || '').trim().toLowerCase();
    if (name && value.trim().toLowerCase() === name) return PASSWORD_REASONS.TOO_GUESSABLE;
    return '';
}

function normalizeAttempts(state) {
    const raw = state && Array.isArray(state.attempts) ? state.attempts : [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        const value = Number(raw[i]);
        if (Number.isFinite(value) && value > 0) out.push(value);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
}

function retryAfterSeconds(untilMs, nowMs) {
    const waitMs = Number(untilMs) - Number(nowMs);
    if (!Number.isFinite(waitMs) || waitMs <= 0) return 1;
    return Math.max(1, Math.ceil(waitMs / 1000));
}

/**
 * Decide whether another reset is allowed for this uid and, if so, return the
 * next state to persist. Attempts older than 24 h are dropped; the caller
 * persists `nextAttempts` BEFORE changing the password so a crash cannot be
 * used to bypass the limit.
 */
function decideResetAttempt(state, nowMs) {
    const now = Number(nowMs);
    if (!Number.isFinite(now) || now <= 0) {
        return { allowed: false, retryAfterSeconds: 60, nextAttempts: null };
    }

    const attempts = normalizeAttempts(state).filter(function (at) {
        return at > now - RESET_DAY_MS && at <= now + CLOCK_SKEW_MS;
    });

    const inWindow = attempts.filter(function (at) { return at > now - RESET_WINDOW_MS; });

    if (inWindow.length >= MAX_RESETS_PER_WINDOW) {
        return {
            allowed: false,
            retryAfterSeconds: retryAfterSeconds(inWindow[0] + RESET_WINDOW_MS, now),
            nextAttempts: null
        };
    }
    if (attempts.length >= MAX_RESETS_PER_DAY) {
        return {
            allowed: false,
            retryAfterSeconds: retryAfterSeconds(attempts[0] + RESET_DAY_MS, now),
            nextAttempts: null
        };
    }

    // Drop a same-millisecond duplicate so two calls in one tick cannot count
    // as two attempts.
    const base = attempts.filter(function (at) { return at !== now; });
    const next = base.concat([now]);
    while (next.length > MAX_TRACKED_ATTEMPTS) next.shift();
    return { allowed: true, retryAfterSeconds: 0, nextAttempts: next };
}

function buildResetLimitState(attempts, nowMs) {
    return {
        attempts: Array.isArray(attempts) ? attempts.slice() : [],
        updatedAt: Number(nowMs)
    };
}

/**
 * RTDB path builders. Both are uid-scoped and must reject anything that could
 * escape the subtree (uid comes from Auth, but validate defensively).
 */
function passwordResetLimitPath(uid) {
    if (!isSafeUid(uid)) return '';
    return 'password_reset_limits/' + uid;
}

function securityEventsPath(uid) {
    if (!isSafeUid(uid)) return '';
    return 'security_events/' + uid;
}

function isSafeUid(uid) {
    return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

module.exports = {
    MIN_PASSWORD_LENGTH,
    MAX_PASSWORD_LENGTH,
    RESET_WINDOW_MS,
    RESET_DAY_MS,
    MAX_RESETS_PER_WINDOW,
    MAX_RESETS_PER_DAY,
    MAX_TRACKED_ATTEMPTS,
    PASSWORD_REASONS,
    validateNewPassword,
    normalizeAttempts,
    decideResetAttempt,
    buildResetLimitState,
    passwordResetLimitPath,
    securityEventsPath,
    isSafeUid
};
