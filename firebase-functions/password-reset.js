/**
 * resetForgottenPassword — set a new password for the signed-in account
 * WITHOUT asking for the current password.
 *
 * Why this exists: ReKindle accounts are `username@rekindle.ink` and never
 * collect a real email address (see firebase-functions/index.js
 * `registerUser`), so there is no email-based "forgot password" link. A user
 * who is still signed in on this device but has forgotten the password had no
 * way back in.
 *
 * Security model (read docs/agent/password-recovery.md before changing it):
 *  - The live Firebase session is the authority. This function deliberately
 *    does NOT require a recent login; requiring one would exclude exactly the
 *    long-lived sessions this feature is for.
 *  - Consequence, accepted by the owner (2026-10-26): anyone who can use the
 *    signed-in device (or holds a valid ID token, e.g. via XSS) can set a new
 *    password and lock the original owner out. Such a session already has
 *    access to notes, files and connected Mail credentials, so this mainly
 *    adds lockout rather than new data exposure. Support can restore access.
 *  - Guardrails: must be signed in, must type the account username, strict
 *    password policy, per-uid rate limit, and an audit entry under
 *    `security_events/{uid}`. The new password is never logged.
 *  - Refresh tokens are NOT revoked: the current device must stay signed in,
 *    and we cannot tell a legitimate owner from a session thief, so a blanket
 *    sign-out would only hurt the owner.
 */

'use strict';

const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { HttpsError } = require('firebase-functions/v2/https');
const lib = require('./password-reset-lib');
const accountLib = require('./account-deletion-lib');

// Client-facing messages. Keep them free of account internals; details carry a
// machine-readable code so settings.html can show a translated string.
const MESSAGES = {
    unauthenticated: 'You must be signed in to change your password.',
    invalidUid: 'Invalid account identifier.',
    confirmation: 'The username you typed does not match this account.',
    fillAll: 'Enter your username and a new password.',
    tooShort: 'New password must be at least 8 characters.',
    tooLong: 'New password is too long.',
    tooGuessable: 'Choose a password that is not your username.',
    rateLimited: 'Too many password changes. Please try again later.',
    rejected: 'That password is not allowed. Choose a stronger one.',
    unavailable: 'This account is no longer available.',
    internal: 'Could not change your password. Please try again.'
};

function clientIp(request) {
    try {
        const rawRequest = request && request.rawRequest;
        const forwarded = rawRequest && rawRequest.headers && rawRequest.headers['x-forwarded-for'];
        const rawIp = (forwarded ? String(forwarded).split(',')[0].trim() : (rawRequest && rawRequest.ip)) || '';
        return String(rawIp).replace(/^::ffff:/, '');
    } catch (e) {
        return '';
    }
}

function tokenEmail(request) {
    return (request && request.auth && request.auth.token && request.auth.token.email) || '';
}

function tokenAuthTime(request) {
    const value = request && request.auth && request.auth.token && request.auth.token.auth_time;
    const authTime = Number(value);
    return Number.isFinite(authTime) && authTime > 0 ? authTime : null;
}

/**
 * Resolve the username the caller must type. The email handle is authoritative
 * for accounts created by `registerUser`; fall back to the public profile for
 * legacy accounts whose address is not `@rekindle.ink`.
 */
async function resolveUsername(rtdb, uid, email) {
    const handle = accountLib.emailHandle(email);
    if (handle) return handle;
    try {
        const snap = await rtdb.ref('users_public/' + uid + '/username').once('value');
        return accountLib.pickUsername([snap ? snap.val() : '', handle]);
    } catch (e) {
        return '';
    }
}

/**
 * @param {object} request Firebase callable request.
 * @param {object} [deps] Test seams: { auth, rtdb, now, serverTimestamp }.
 */
async function resetForgottenPassword(request, deps) {
    deps = deps || {};

    if (!request || !request.auth || !request.auth.uid) {
        throw new HttpsError('unauthenticated', MESSAGES.unauthenticated);
    }

    const uid = request.auth.uid;
    if (!lib.isSafeUid(uid)) {
        throw new HttpsError('invalid-argument', MESSAGES.invalidUid);
    }

    const data = request.data || {};
    const typedUsername = data.username;
    const newPassword = data.newPassword;

    if ((typeof typedUsername !== 'string' || !typedUsername.trim()) ||
        (typeof newPassword !== 'string' || !newPassword)) {
        throw new HttpsError('invalid-argument', MESSAGES.fillAll, { code: 'missing-fields' });
    }

    const authApi = deps.auth || admin.auth();
    const rtdb = deps.rtdb || admin.database();
    const now = typeof deps.now === 'function' ? deps.now() : Date.now();

    const username = await resolveUsername(rtdb, uid, tokenEmail(request));
    if (!accountLib.confirmationMatches(typedUsername, username)) {
        throw new HttpsError('permission-denied', MESSAGES.confirmation, { code: 'confirmation-mismatch' });
    }

    const reason = lib.validateNewPassword(newPassword, username);
    if (reason) {
        if (reason === lib.PASSWORD_REASONS.TOO_SHORT) {
            throw new HttpsError('invalid-argument', MESSAGES.tooShort, { code: reason });
        }
        if (reason === lib.PASSWORD_REASONS.TOO_LONG) {
            throw new HttpsError('invalid-argument', MESSAGES.tooLong, { code: reason });
        }
        if (reason === lib.PASSWORD_REASONS.TOO_GUESSABLE) {
            throw new HttpsError('invalid-argument', MESSAGES.tooGuessable, { code: reason });
        }
        throw new HttpsError('invalid-argument', MESSAGES.fillAll, { code: reason });
    }

    // Reserve an attempt BEFORE touching Auth. A transaction keeps concurrent
    // requests from each reading the old count and all being allowed.
    const limitPath = lib.passwordResetLimitPath(uid);
    let decision = null;
    try {
        const result = await rtdb.ref(limitPath).transaction(function (current) {
            decision = lib.decideResetAttempt(current, now);
            if (!decision.allowed) return; // abort: keep the existing state
            return lib.buildResetLimitState(decision.nextAttempts, now);
        });
        if (!result || !result.committed) {
            const blocked = lib.decideResetAttempt(result && result.snapshot ? result.snapshot.val() : null, now);
            throw new HttpsError('resource-exhausted', MESSAGES.rateLimited, {
                code: 'rate-limited',
                // If the abort raced a concurrent delete, fall back to a
                // sensible wait instead of telling the user "0 seconds".
                retryAfterSeconds: blocked.allowed ? 60 : blocked.retryAfterSeconds
            });
        }
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        logger.error('resetForgottenPassword: rate-limit transaction failed', {
            uid: uid,
            message: e && e.message
        });
        throw new HttpsError('internal', MESSAGES.internal);
    }

    try {
        await authApi.updateUser(uid, { password: newPassword });
    } catch (e) {
        const code = (e && e.code) ? e.code : '';
        if (code === 'auth/user-not-found') {
            throw new HttpsError('not-found', MESSAGES.unavailable, { code: 'account-missing' });
        }
        if (code === 'auth/invalid-password' || code === 'auth/weak-password' ||
            code === 'auth/password-does-not-meet-requirements') {
            throw new HttpsError('invalid-argument', MESSAGES.rejected, { code: 'password-rejected' });
        }
        logger.error('resetForgottenPassword: updateUser failed', {
            uid: uid,
            code: code,
            message: e && e.message
        });
        throw new HttpsError('internal', MESSAGES.internal);
    }

    const ip = clientIp(request);
    const serverTimestamp = deps.serverTimestamp || admin.database.ServerValue.TIMESTAMP;
    try {
        const auditPath = lib.securityEventsPath(uid);
        await rtdb.ref(auditPath).push({
            type: 'password_reset_without_current',
            at: serverTimestamp,
            authTime: tokenAuthTime(request),
            ip: ip || null
        });
    } catch (e) {
        // The password is already changed; never fail the request over the
        // audit trail. The structured log line below is the fallback record.
        logger.warn('resetForgottenPassword: audit write failed', {
            uid: uid,
            message: e && e.message
        });
    }

    logger.info('resetForgottenPassword: password changed without current password', {
        uid: uid,
        ip: ip || null,
        authTime: tokenAuthTime(request)
    });

    return { success: true, changedAt: now };
}

module.exports = {
    resetForgottenPassword,
    MESSAGES
};
