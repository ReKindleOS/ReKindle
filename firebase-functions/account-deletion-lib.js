/**
 * Pure helpers for permanent account deletion (`deleteAccount`).
 *
 * Deliberately free of firebase-admin / firebase-functions imports so
 * `scripts/test-account-deletion.js` can exercise the confirmation rules,
 * the recent-login window and the RTDB path builder without credentials.
 * The destructive I/O lives in `account-deletion.js`.
 *
 * Design rules (keep these true):
 *  - Only server code decides what is deleted. The browser sends the typed
 *    confirmation and the password (via Firebase reauthentication); it never
 *    supplies a uid, path or list of documents.
 *  - Every path is built from the authenticated uid plus values read from the
 *    database, and is rejected if it contains an RTDB separator.
 *  - Deletion is idempotent: running it twice removes the same nodes, and an
 *    interrupted run can be retried because the Auth record is deleted last.
 */

// Reauthentication is required within this window. The client always calls
// reauthenticateWithCredential immediately before invoking the function, so
// the only users who hit this are scripted callers holding an old ID token.
const RECENT_AUTH_MAX_SECONDS = 10 * 60;

// Small tolerance for clock skew between the function host and Firebase Auth.
const CLOCK_SKEW_SECONDS = 60;

// Hard stop before the 540 s function timeout. If a user owns an unusually
// large amount of content the function aborts *before* deleting the Auth
// record, so the account still exists and a retry can finish the job.
const DELETION_TIME_BUDGET_MS = 8 * 60 * 1000;

// Firestore batches are capped at 500 writes; leave headroom for counter
// repairs that may be committed alongside comment deletes.
const FIRESTORE_BATCH_SIZE = 400;

// RTDB multi-path updates have no documented path cap, but very large updates
// are rejected. Chat cleanup batches 200 messages (~2,400 paths) like
// `cleanupSocial`.
const CHAT_BATCH_SIZE = 200;

// Primary-project RTDB nodes that are keyed directly by uid (or by the
// account's email handle, for the retired primary-chat rate limit node).
const PRIMARY_USER_RTDB_ROOTS = [
    'users_public',
    'user_cards',
    'users_private',
    'presence',
    'timeouts',
    'moderators',
    // Written by the mail callables (firebase-functions/index.js
    // mail_rate_limits/{uid}/{kind}); no content, but it is uid-keyed.
    'mail_rate_limits',
    // Written by resetForgottenPassword (password-reset.js): the per-uid
    // attempt window and the "password changed without current password"
    // audit entries. Both are uid-keyed and must not outlive the account.
    'password_reset_limits',
    'security_events'
];

// Social-project RTDB nodes keyed by uid. DM threads/messages/blocks are not in
// this list because they have to be discovered and removed as a graph (see
// account-deletion.js).
const SOCIAL_USER_RTDB_ROOTS = [
    'users_public',
    'user_cards',
    'users_private',
    // The moderation worker applies Discord-issued timeouts in the SOCIAL
    // project (`timeouts/{uid}`), while moderation.html writes the same node
    // in the primary project. Both are cleared.
    'timeouts',
    'kindlechat/server_rate_limits',
    'kindlechat/user_recent',
    'kindlechat/dm_prefs'
];

function normalizeAccountName(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().toLowerCase();
}

/**
 * The confirmation text must equal the account's username (case-insensitive,
 * surrounding whitespace ignored). It must never be empty: `confirmationMatches`
 * returning true for a missing username would let a malformed profile bypass
 * the typed-confirmation step entirely.
 */
function confirmationMatches(input, username) {
    const expected = normalizeAccountName(username);
    if (!expected) return false;
    return normalizeAccountName(input) === expected;
}

function isRecentAuth(authTimeSeconds, nowMs, maxAgeSeconds) {
    const authTime = Number(authTimeSeconds);
    const now = Number(nowMs);
    const maxAge = Number(maxAgeSeconds === undefined ? RECENT_AUTH_MAX_SECONDS : maxAgeSeconds);
    if (!Number.isFinite(authTime) || authTime <= 0) return false;
    if (!Number.isFinite(now) || now <= 0) return false;
    if (!Number.isFinite(maxAge) || maxAge < 0) return false;

    const ageSeconds = Math.floor(now / 1000) - authTime;
    if (ageSeconds < -CLOCK_SKEW_SECONDS) return false; // token from the future
    return ageSeconds <= maxAge;
}

function emailHandle(email) {
    const value = String(email || '');
    const at = value.indexOf('@');
    return (at === -1 ? value : value.slice(0, at)).trim();
}

/**
 * Pick the public username the user must type. Register-time usernames live in
 * users_public/{uid}/username; social profiles can override it later, so try
 * the primary profile, then the social profile, then the email handle.
 */
function pickUsername(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    for (let i = 0; i < list.length; i++) {
        const value = list[i];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function isValidUid(uid) {
    return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

/**
 * RTDB keys cannot contain `. # $ [ ] /` or whitespace. Usernames are
 * alphanumeric today, but legacy email handles can contain dots/pluses, so
 * reject only the characters that would let a path escape its subtree or make
 * the multi-path update invalid.
 */
function isSafePathPart(value) {
    if (typeof value !== 'string') return false;
    if (!value || value.length > 128) return false;
    return !/[.#$\[\]/\s]/.test(value);
}

function buildPrimaryUserDeletePaths(uid, handle) {
    const updates = {};
    if (!isValidUid(uid)) return updates;

    for (let i = 0; i < PRIMARY_USER_RTDB_ROOTS.length; i++) {
        updates[PRIMARY_USER_RTDB_ROOTS[i] + '/' + uid] = null;
    }
    if (isSafePathPart(handle)) {
        updates['kindlechat/user_limits/' + handle] = null;
    }
    return updates;
}

function buildSocialUserDeletePaths(uid) {
    const updates = {};
    if (!isValidUid(uid)) return updates;

    for (let i = 0; i < SOCIAL_USER_RTDB_ROOTS.length; i++) {
        updates[SOCIAL_USER_RTDB_ROOTS[i] + '/' + uid] = null;
    }
    return updates;
}

/**
 * Reports are moderation records, but they also contain a snapshot of the
 * reported content and the reporter's name. On account deletion remove both
 * directions: reports the user submitted and reports about the user.
 */
function shouldDeleteReportForUser(report, uid) {
    if (!report || typeof report !== 'object') return false;
    if (!isValidUid(uid)) return false;
    return report.reporterId === uid || report.reportedUserId === uid;
}

function emptySummary() {
    return {
        authUsers: 0,
        firestoreDocuments: 0,
        topics: 0,
        topicComments: 0,
        neighbourhoodPosts: 0,
        neighbourhoodComments: 0,
        chatMessages: 0,
        chatTranslations: 0,
        artEntries: 0,
        dmThreads: 0,
        dmMessages: 0,
        reports: 0,
        rtdbNodes: 0,
        storageObjects: 0,
        suggestions: 0,
        gameRuns: 0
    };
}

function addToSummary(target, key, amount) {
    if (!target || typeof target !== 'object') return target;
    const increment = Number(amount);
    if (!Number.isFinite(increment)) return target;
    target[key] = (Number(target[key]) || 0) + increment;
    return target;
}

module.exports = {
    RECENT_AUTH_MAX_SECONDS,
    CLOCK_SKEW_SECONDS,
    DELETION_TIME_BUDGET_MS,
    FIRESTORE_BATCH_SIZE,
    CHAT_BATCH_SIZE,
    PRIMARY_USER_RTDB_ROOTS,
    SOCIAL_USER_RTDB_ROOTS,
    normalizeAccountName,
    confirmationMatches,
    isRecentAuth,
    emailHandle,
    pickUsername,
    isValidUid,
    isSafePathPart,
    buildPrimaryUserDeletePaths,
    buildSocialUserDeletePaths,
    shouldDeleteReportForUser,
    emptySummary,
    addToSummary
};
