/**
 * resetWithRecoveryCode — set a new password from a signed-out browser using
 * the one-time recovery code saved in Settings.
 *
 * Security model:
 *  - The code is a 20-character (~99-bit) bearer secret. Only its salted
 *    SHA-256 hash is stored (Firestore privateSettings/recovery).
 *  - The callable is public (no auth by design) but rate-limited per uid and
 *    per IP before it touches Auth. Unknown usernames and wrong codes return
 *    the same generic error.
 *  - The code is consumed on success. Refresh tokens are revoked so a lost
 *    device cannot keep the old session.
 *  - No email is sent and no email address is collected.
 */
'use strict';

const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { HttpsError } = require('firebase-functions/v2/https');
const lib = require('./recovery-lib');

const MESSAGES = {
    invalid: 'That username or recovery code is not valid.',
    rateLimited: 'Too many attempts. Please wait and try again.',
    password: 'Choose a password with at least 8 characters.',
    unavailable: 'This account is no longer available.',
    internal: 'Could not reset the password. Please try again.'
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

async function lookupUid(rtdb, username) {
    const snap = await rtdb.ref('user_cards').orderByChild('username').equalTo(username).once('value');
    let uid = null;
    if (snap.exists()) {
        snap.forEach(function (child) {
            if (!uid && child.key) uid = child.key;
        });
    }
    return uid;
}

async function reserve(rtdb, path, now, message) {
    let decision = null;
    const result = await rtdb.ref(path).transaction(function (current) {
        decision = lib.decideRecoveryAttempt(current, now);
        if (!decision.allowed) return;
        return lib.buildLimitState(decision.nextAttempts, now);
    });
    if (!result || !result.committed) {
        const blocked = lib.decideRecoveryAttempt(result && result.snapshot ? result.snapshot.val() : null, now);
        throw new HttpsError('resource-exhausted', message, {
            code: 'rate-limited',
            retryAfterSeconds: blocked.allowed ? 60 : blocked.retryAfterSeconds
        });
    }
}

/**
 * @param {object} request Firebase callable request.
 * @param {object} [deps] Test seams: { auth, firestore, rtdb, now, serverTimestamp }.
 */
async function resetWithRecoveryCode(request, deps) {
    deps = deps || {};
    const data = request && request.data ? request.data : {};
    const username = typeof data.username === 'string' ? data.username.trim() : '';
    const code = data.code;
    const newPassword = data.newPassword;

    if (!lib.isValidUsername(username) || !lib.isValidCode(code) || typeof newPassword !== 'string') {
        throw new HttpsError('invalid-argument', MESSAGES.invalid, { code: 'invalid-recovery' });
    }

    const authApi = deps.auth || admin.auth();
    const firestore = deps.firestore || admin.firestore();
    const rtdb = deps.rtdb || admin.database();
    const now = typeof deps.now === 'function' ? deps.now() : Date.now();
    const ip = clientIp(request);

    // Per-IP first, so a script cannot hammer username lookups.
    if (ip) {
        try {
            await reserve(rtdb, lib.ipLimitPath(lib.hashIp(ip)), now, MESSAGES.rateLimited);
        } catch (e) {
            if (e instanceof HttpsError) throw e;
            logger.error('recovery: IP limit failed', { message: e && e.message });
            throw new HttpsError('internal', MESSAGES.internal);
        }
    }

    let uid = null;
    try {
        uid = await lookupUid(rtdb, username);
    } catch (e) {
        logger.error('recovery: username lookup failed', { message: e && e.message });
        throw new HttpsError('internal', MESSAGES.internal);
    }
    if (!uid) {
        // Dummy hash so an unknown username is not obviously faster.
        lib.hashCode('00000000', '0000000000000000', code);
        throw new HttpsError('permission-denied', MESSAGES.invalid, { code: 'invalid-recovery' });
    }

    try {
        await reserve(rtdb, lib.limitPath(uid), now, MESSAGES.rateLimited);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        logger.error('recovery: uid limit failed', { uid: uid, message: e && e.message });
        throw new HttpsError('internal', MESSAGES.internal);
    }

    let doc = null;
    try {
        doc = await firestore.collection('users').doc(uid)
            .collection('privateSettings').doc('recovery').get();
    } catch (e) {
        logger.error('recovery: recovery record read failed', { uid: uid, message: e && e.message });
        throw new HttpsError('internal', MESSAGES.internal);
    }

    const stored = doc && doc.exists ? doc.data() : null;
    const salt = stored && stored.salt ? String(stored.salt) : '00000000000000000000000000000000';
    const expected = stored && stored.hash ? String(stored.hash) : '0'.repeat(64);
    const actual = lib.hashCode(uid, salt, code);
    if (!stored || !lib.safeEqualHex(actual, expected)) {
        throw new HttpsError('permission-denied', MESSAGES.invalid, { code: 'invalid-recovery' });
    }

    const reason = lib.passwordReason(newPassword, username);
    if (reason) {
        throw new HttpsError('invalid-argument', MESSAGES.password, { code: reason });
    }

    try {
        await authApi.updateUser(uid, { password: newPassword });
    } catch (e) {
        const code = (e && e.code) ? e.code : '';
        if (code === 'auth/user-not-found') {
            throw new HttpsError('not-found', MESSAGES.unavailable, { code: 'account-missing' });
        }
        logger.error('recovery: password update failed', { uid: uid, code: code, message: e && e.message });
        throw new HttpsError('internal', MESSAGES.internal);
    }

    // The password is already changed. A token-revocation failure must not turn
    // a successful reset into an error.
    try {
        await authApi.revokeRefreshTokens(uid);
    } catch (e) {
        logger.warn('recovery: refresh-token revocation failed', { uid: uid, message: e && e.message });
    }

    // Consume the code and audit, best-effort. The password is already changed;
    // a failure here must not turn a successful reset into an error.
    try {
        await firestore.collection('users').doc(uid)
            .collection('privateSettings').doc('recovery').delete();
    } catch (e) {
        logger.warn('recovery: could not delete consumed code', { uid: uid, message: e && e.message });
    }
    try {
        await rtdb.ref('security_events/' + uid).push({
            type: 'password_reset_recovery_code',
            at: deps.serverTimestamp || admin.database.ServerValue.TIMESTAMP,
            ip: ip || null
        });
    } catch (e) {
        logger.warn('recovery: audit write failed', { uid: uid, message: e && e.message });
    }

    return { ok: true };
}

module.exports = {
    resetWithRecoveryCode: resetWithRecoveryCode,
    MESSAGES: MESSAGES,
    clientIp: clientIp,
    lookupUid: lookupUid
};
