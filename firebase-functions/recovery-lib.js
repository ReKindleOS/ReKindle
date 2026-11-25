/**
 * Pure helpers for recovery-code password resets.
 *
 * No firebase-admin / firebase-functions imports so scripts/test-recovery.js
 * can exercise the code format, hashing and rate-limit decisions in CI.
 */
'use strict';

const crypto = require('crypto');
const passwordReset = require('./password-reset-lib');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 20;

function normaliseCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidCode(value) {
    const clean = normaliseCode(value);
    if (clean.length !== CODE_LENGTH) return false;
    for (let i = 0; i < clean.length; i++) {
        if (ALPHABET.indexOf(clean.charAt(i)) === -1) return false;
    }
    return true;
}

function isValidUsername(value) {
    return typeof value === 'string' && /^[A-Za-z0-9]{1,20}$/.test(value);
}

function hashCode(uid, salt, code) {
    return crypto.createHash('sha256')
        .update(String(uid) + ':' + String(salt) + ':' + normaliseCode(code))
        .digest('hex');
}

function safeEqualHex(a, b) {
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');
    if (!left.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function limitPath(uid) {
    return 'recovery_limits/' + uid;
}

function ipLimitPath(hashedIp) {
    return 'recovery_ip_limits/' + hashedIp;
}

function hashIp(ip) {
    return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}

function decideRecoveryAttempt(state, nowMs) {
    // Same 3/hour, 5/day shape as the signed-in reset, kept as a separate
    // bucket so a user cannot mix the two paths to get extra attempts.
    return passwordReset.decideResetAttempt(state, nowMs);
}

function buildLimitState(nextAttempts, nowMs) {
    return passwordReset.buildResetLimitState(nextAttempts, nowMs);
}

function passwordReason(password, username) {
    return passwordReset.validateNewPassword(password, username);
}

module.exports = {
    ALPHABET,
    CODE_LENGTH,
    normaliseCode,
    isValidCode,
    isValidUsername,
    hashCode,
    safeEqualHex,
    limitPath,
    ipLimitPath,
    hashIp,
    decideRecoveryAttempt,
    buildLimitState,
    passwordReason
};
