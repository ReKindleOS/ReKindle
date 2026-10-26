/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions/v1");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const net = require("net");
const dns = require("dns").promises;
const { ImapFlow } = require("imapflow");
const simpleParser = require("mailparser").simpleParser;
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const mailOAuth = require("./mail-oauth-config");
// jose removed — no longer needed after AgeVerif integration removal

admin.initializeApp();

// Initialize secondary admin app for social project (rekindle-socials)
let socialAdminApp = null;
try {
    const socialServiceAccount = JSON.parse(process.env.SOCIAL_SERVICE_ACCOUNT_JSON || '{}');
    if (socialServiceAccount.project_id) {
        socialAdminApp = admin.initializeApp({
            credential: admin.credential.cert(socialServiceAccount),
            projectId: socialServiceAccount.project_id,
            databaseURL: 'https://rekindle-socials-default-rtdb.firebaseio.com'
        }, 'social');
        logger.info('Social admin app initialized for project:', socialServiceAccount.project_id);
    } else {
        logger.warn('SOCIAL_SERVICE_ACCOUNT_JSON not set — social features will be unavailable.');
    }
} catch (e) {
    logger.error('Failed to initialize social admin app:', e);
}

// Allowed origins (same as Cloudflare workers)
const allowedOrigins = [
    "https://beta.rekindle.ink",
    "https://rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
];

// Common options for all functions
const callOptions = {
    cors: allowedOrigins,  // Restrict to allowed origins only
    maxInstances: 10,      // Limit concurrency for IMAP connections to avoid hitting limits
    timeoutSeconds: 60     // Outbound IMAP/SMTP calls must not hang a function slot
};

// Mail callables are expensive (outbound IMAP/SMTP connections) and were
// previously callable by anyone with the public Firebase config. They now
// require Firebase auth + an active ReKindle+ subscription, are rate-limited,
// and refuse private/link-local targets. Keep these helpers near the top so
// every mail function uses the same rules.
const IMAP_PORTS = [993, 143];
const SMTP_PORTS = [465, 587];

function requireAuth(request) {
    if (!request.auth || !request.auth.uid) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    return request.auth;
}

function isPrivateIPAddress(ip) {
    if (!ip) return true;

    if (net.isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        return parts[0] === 0 ||
            parts[0] === 10 ||
            parts[0] === 127 ||
            (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
            (parts[0] === 169 && parts[1] === 254) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
            parts[0] >= 224;
    }

    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        if (lower === '::' || lower === '::1') return true;
        if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
        if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link local
        if (lower.startsWith('::ffff:')) return isPrivateIPAddress(lower.slice(7));
        return false;
    }

    return false;
}

async function assertMailEndpoint(host, port, kind) {
    if (typeof host !== 'string' || !host.trim() || host.length > 253 || /[\s/\\]/.test(host)) {
        throw new HttpsError('invalid-argument', 'Invalid mail server host.');
    }

    const cleanHost = host.trim();
    const numericPort = Number(port);
    const allowedPorts = kind === 'smtp' ? SMTP_PORTS : IMAP_PORTS;
    if (allowedPorts.indexOf(numericPort) === -1) {
        throw new HttpsError('invalid-argument', 'Unsupported mail server port.');
    }

    if (net.isIP(cleanHost)) {
        if (isPrivateIPAddress(cleanHost)) {
            throw new HttpsError('permission-denied', 'Mail server address is not allowed.');
        }
        return;
    }

    let addresses;
    try {
        addresses = await dns.lookup(cleanHost, { all: true });
    } catch (e) {
        throw new HttpsError('invalid-argument', 'Mail server host could not be resolved.');
    }
    if (!addresses || !addresses.length) {
        throw new HttpsError('invalid-argument', 'Mail server host could not be resolved.');
    }
    for (const entry of addresses) {
        if (isPrivateIPAddress(entry.address)) {
            throw new HttpsError('permission-denied', 'Mail server address is not allowed.');
        }
    }
}

function assertMailAuthConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new HttpsError('invalid-argument', 'Missing mail server configuration.');
    }
    if (!config.auth || typeof config.auth.user !== 'string' || typeof config.auth.pass !== 'string') {
        throw new HttpsError('invalid-argument', 'Missing mail server credentials.');
    }
    if (config.auth.user.length > 320 || config.auth.pass.length > 1024) {
        throw new HttpsError('invalid-argument', 'Mail server credentials are too long.');
    }
}

async function isUserPro(uid, email, token) {
    if (token && token.pro === true) return true;
    if (email === 'ukiyo@rekindle.ink') return true;

    const db = admin.firestore();

    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            const data = doc.data();
            if (data && data.proExpiresAt) {
                const expires = data.proExpiresAt.toMillis ? data.proExpiresAt.toMillis() : new Date(data.proExpiresAt).getTime();
                if (expires > Date.now()) return true;
            }
        }
    } catch (e) {
        logger.warn('isUserPro user lookup failed:', e.message);
    }

    if (email) {
        try {
            const supporters = await db.collection('config').doc('supporters').get();
            if (supporters.exists) {
                const data = supporters.data() || {};
                const entry = data[email];
                if (entry && entry.expiresAt) {
                    const expires = entry.expiresAt.toMillis ? entry.expiresAt.toMillis() : new Date(entry.expiresAt).getTime();
                    if (expires > Date.now()) return true;
                }
            }
        } catch (e) {
            logger.warn('isUserPro supporters lookup failed:', e.message);
        }
    }

    return false;
}

async function assertMailRate(uid, kind, limit, windowMs) {
    const ref = admin.database().ref(`mail_rate_limits/${uid}/${kind}`);
    const now = Date.now();
    let allowed = true;

    const result = await ref.transaction(function (current) {
        if (!current || typeof current.windowStart !== 'number' || now - current.windowStart > windowMs) {
            return { windowStart: now, count: 1 };
        }
        if (current.count >= limit) {
            allowed = false;
            return; // abort
        }
        return { windowStart: current.windowStart, count: current.count + 1 };
    });

    if (!result.committed || !allowed) {
        throw new HttpsError('resource-exhausted', 'Too many mail requests. Please try again later.');
    }
}

// Mail opens a callable per folder/message; each one re-read the Pro status
// (up to two Firestore reads, including the whole supporters map). A short
// cache is safe: a cancelled subscription still loses access within a minute.
const proStatusCache = new Map(); // uid -> { value: boolean, expires: number }
const PRO_CACHE_TTL_MS = 60 * 1000;

async function isUserProCached(uid, email, token) {
    const hit = proStatusCache.get(uid);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await isUserPro(uid, email, token);
    proStatusCache.set(uid, { value, expires: Date.now() + PRO_CACHE_TTL_MS });
    if (proStatusCache.size > 1000) {
        const now = Date.now();
        for (const [key, entry] of proStatusCache) {
            if (entry.expires <= now) proStatusCache.delete(key);
        }
    }
    return value;
}

async function assertMailAccess(request, kind) {
    const auth = requireAuth(request);
    const pro = await isUserProCached(auth.uid, auth.token.email, auth.token);
    if (!pro) {
        throw new HttpsError('permission-denied', 'ReKindle+ is required for mail.');
    }
    if (kind === 'smtp') {
        await assertMailRate(auth.uid, 'smtp', 10, 60 * 60 * 1000);
    } else if (kind === 'imap') {
        await assertMailRate(auth.uid, 'imap', 30, 5 * 60 * 1000);
    } else if (kind === 'oauth') {
        // Starting an Outlook device-code flow is rare; 20/hour is plenty.
        await assertMailRate(auth.uid, 'oauth', 20, 60 * 60 * 1000);
    }
    // kind === 'none' (device-code polling) runs the Pro check only: one poll
    // per 5s for up to 15 minutes would blow through any sensible window, and
    // the device code is single-use and expires on its own.
    return auth;
}

/*
 * ── Outlook / Hotmail OAUTH2 ────────────────────────────────────────────────
 *
 * Microsoft retired Basic Auth for Outlook.com IMAP/SMTP on 2024-09-16, so a
 * Hotmail account can only be reached with SASL XOAUTH2. The browser cannot do
 * Microsoft's sign-in (their login page is a JS-only app with no form fallback,
 * and ROPC is unavailable for personal accounts), so setup uses the OAuth2
 * device-code grant: the Kindle shows a short code, the user enters it on a
 * phone/computer, and this backend keeps the refresh token.
 *
 * Tokens live at `mail_oauth/{uid}` in RTDB, which has no rule (default deny)
 * exactly like `mail_rate_limits` — only the Admin SDK can read it, and no
 * callable ever returns the refresh token.
 */

const MS_ACCOUNT_PATH = 'mail_oauth';
const MS_PENDING_PATH = 'mail_oauth_pending';

// uid -> { email, accessToken, expiresAt }. Warm instances reuse the access
// token instead of refreshing on every folder/message call.
const msTokenCache = new Map();
const msRefreshing = new Map();
const MS_TOKEN_CACHE_MAX = 500;

function decodeJwtPayload(jwt) {
    try {
        const part = String(jwt || '').split('.')[1];
        if (!part) return null;
        const padded = part.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (e) {
        return null;
    }
}

async function msPostForm(url, params) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(20000)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* handled by caller */ }
    if (!json) {
        throw new HttpsError('internal', 'Outlook sign-in returned an unexpected response.');
    }
    return { ok: res.ok, status: res.status, json };
}

async function getMicrosoftAccessToken(uid, accountId) {
    // One ReKindle user can link several mailboxes, including several Microsoft
    // ones, so the cache key is (user, account) rather than just the user.
    const cacheKey = `${uid}:${accountId}`;
    const cached = msTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached;

    // Collapse concurrent refreshes inside one instance (mail.html fires folder
    // list + message list together). Rotation across instances still races, but
    // the access token cache makes a refresh a once-an-hour event.
    if (msRefreshing.has(cacheKey)) return msRefreshing.get(cacheKey);

    const pending = (async () => {
        const clientId = mailOAuth.microsoftClientId();
        if (!clientId) {
            throw new HttpsError('failed-precondition', 'Outlook sign-in is not configured yet.');
        }

        const snap = await admin.database().ref(`${MS_ACCOUNT_PATH}/${uid}/${accountId}`).get();
        const account = snap.exists() ? snap.val() : null;
        if (!account || !account.refreshToken) {
            throw new HttpsError('failed-precondition', 'No Outlook account is connected.');
        }

        const { ok, json } = await msPostForm(mailOAuth.microsoftTokenUrl(), {
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken,
            scope: mailOAuth.microsoftScopes()
        });

        if (!ok || !json.access_token) {
            const code = String(json.error || '');
            logger.warn('Microsoft token refresh failed', { uid, code, desc: json.error_description });
            if (code === 'invalid_grant' || code === 'interaction_required' || code === 'consent_required') {
                // Dead token: drop it so the UI can ask for a reconnect instead
                // of retrying a credential Microsoft has already rejected.
                await admin.database().ref(`${MS_ACCOUNT_PATH}/${uid}/${accountId}`).remove().catch(() => { });
                throw new HttpsError('permission-denied', 'Outlook connection expired. Reconnect it in Mail settings.');
            }
            throw new HttpsError('internal', 'Could not reach Outlook. Try again later.');
        }

        const idPayload = json.id_token ? decodeJwtPayload(json.id_token) : null;
        const entry = {
            email: (idPayload && (idPayload.preferred_username || idPayload.email)) || account.email,
            accessToken: json.access_token,
            expiresAt: Date.now() + Math.max(60, (Number(json.expires_in) || 3600) - 300) * 1000
        };

        if (json.refresh_token && json.refresh_token !== account.refreshToken) {
            await admin.database().ref(`${MS_ACCOUNT_PATH}/${uid}/${accountId}`)
                .update({ refreshToken: json.refresh_token, updatedAt: Date.now() })
                .catch(e => logger.warn('Could not persist rotated refresh token', e.message));
        }

        return entry;
    })();

    msRefreshing.set(cacheKey, pending);
    try {
        const entry = await pending;
        if (msTokenCache.size > MS_TOKEN_CACHE_MAX) msTokenCache.clear();
        msTokenCache.set(cacheKey, entry);
        return entry;
    } finally {
        msRefreshing.delete(cacheKey);
    }
}

/**
 * Resolve the real connection details for a mail callable.
 *
 * OAuth accounts: endpoint + auth come from mail-oauth-config (host is pinned
 * to Microsoft, so a bearer token can never be aimed at another server).
 * Password accounts: unchanged — validate creds, then SSRF-guard the host.
 */
async function resolveMailConnection(uid, config, kind) {
    if (!config || typeof config !== 'object') {
        throw new HttpsError('invalid-argument', `Missing ${String(kind).toUpperCase()} configuration.`);
    }

    if (mailOAuth.isMicrosoftOAuth(config)) {
        const accountId = typeof config.accountId === 'string' ? config.accountId.trim() : '';
        if (!accountId) {
            throw new HttpsError('invalid-argument', 'Missing Outlook account id.');
        }
        const tokens = await getMicrosoftAccessToken(uid, accountId);
        const endpoint = mailOAuth.endpointFor(config, kind);
        return Object.assign({}, endpoint, { auth: mailOAuth.authFor(config, kind, tokens) });
    }

    assertMailAuthConfig(config);
    const endpoint = mailOAuth.endpointFor(config, kind);
    await assertMailEndpoint(endpoint.host, endpoint.port, kind);
    return Object.assign({}, endpoint, { auth: config.auth });
}

// AgeVerif integration removed — replaced with self-declaration flow.

/**
 * Default minimum legal age for social media by country (ISO 3166-1 alpha-2).
 * These reflect the minimum age at which users can legally access social media
 * platforms in each jurisdiction as of 2025–2026.
 * A Firestore `/config/age_requirements` document can override these at runtime.
 */
const DEFAULT_SOCIAL_MEDIA_MIN_AGE = {
    // North America
    US: 13,  // COPPA
    CA: 13,  // PIPEDA
    MX: 13,
    // Europe
    UK: 13,
    DE: 16,  // Germany
    NL: 16,  // Netherlands
    FR: 15,  // France
    BE: 13,
    ES: 14,  // Spain
    IT: 14,  // Italy
    PT: 13,
    IE: 13,
    AT: 14,
    SE: 13,
    NO: 13,
    DK: 13,
    FI: 13,
    PL: 13,
    CZ: 13,
    SK: 13,
    HU: 13,
    RO: 13,
    BG: 13,
    HR: 13,
    SI: 13,
    LT: 13,
    LV: 13,
    EE: 13,
    GR: 13,
    CY: 13,
    MT: 13,
    LU: 13,
    CH: 13,
    IS: 13,
    LI: 13,
    // Asia-Pacific
    AU: 16,  // Australia — under-16 ban (effective late 2025)
    NZ: 13,
    JP: 13,
    KR: 14,  // South Korea
    CN: 13,
    TW: 13,
    HK: 13,
    SG: 13,
    MY: 13,
    TH: 13,
    PH: 13,
    ID: 13,
    VN: 13,
    IN: 13,
    PK: 13,
    BD: 13,
    LK: 13,
    NP: 13,
    // Middle East / Africa
    IL: 13,
    TR: 13,
    SA: 13,
    AE: 13,
    QA: 13,
    KW: 13,
    BH: 13,
    OM: 13,
    EG: 13,
    ZA: 13,
    NG: 13,
    KE: 13,
    GH: 13,
    TZ: 13,
    UG: 13,
    RW: 13,
    ET: 13,
    // South America
    BR: 13,  // LGPD
    AR: 13,
    CL: 13,
    CO: 13,
    PE: 13,
    VE: 13,
    EC: 13,
    UY: 13,
    PY: 13,
    BO: 13,
    // Central America / Caribbean
    CR: 13,
    PA: 13,
    GT: 13,
    HN: 13,
    SV: 13,
    NI: 13,
    DO: 13,
    CU: 13,
    JM: 13,
    TT: 13,
    // Oceania
    FJ: 13,
    PG: 13,
    // Default for unlisted countries
    DEFAULT: 13,
};

/**
 * Fetch the minimum social media age for a country.
 * Checks Firestore `/config/age_requirements` first, then falls back to defaults.
 */
async function getMinimumSocialMediaAge(countryCode) {
    const code = (countryCode || '').toUpperCase();
    try {
        const doc = await admin.firestore().collection('config').doc('age_requirements').get();
        if (doc.exists) {
            const data = doc.data();
            if (data && typeof data[code] === 'number') {
                return data[code];
            }
        }
    } catch (e) {
        logger.warn('Failed to read age_requirements config:', e.message);
    }
    return DEFAULT_SOCIAL_MEDIA_MIN_AGE[code] || DEFAULT_SOCIAL_MEDIA_MIN_AGE.DEFAULT;
}

async function logModAction(type, targetUid, targetName, reason, extra = {}) {
    const logKey = admin.database().ref('mod_actions').push().key;
    const entry = {
        type,
        moderatorUid: 'system',
        moderatorName: 'System (Auto)',
        targetUid,
        targetName: targetName || targetUid,
        reason,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        undone: false,
        systemAction: true,
        ...extra
    };
    await admin.database().ref(`mod_actions/${logKey}`).set(entry);
}

/**
 * Calculate age from date of birth.
 */
function calculateAge(day, month, year) {
    const today = new Date();
    let age = today.getFullYear() - year;
    const m = today.getMonth() + 1 - month;
    if (m < 0 || (m === 0 && today.getDate() < day)) {
        age--;
    }
    return age;
}

/**
 * Verify age via self-declared date of birth and country.
 * Server-side calculation enforces country-specific minimum social-media age.
 *
 * Expects: { dob: { day: number, month: number, year: number }, country: string }
 * Returns: { success: boolean, reason?: string, country?: string, age?: number, minimumAge?: number }
 */
exports.verifyAgeSelfDeclaration = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }

    const { dob, country } = request.data || {};
    if (!dob || typeof dob !== 'object') {
        throw new HttpsError('invalid-argument', 'Missing date of birth.');
    }

    const day = parseInt(dob.day, 10);
    const month = parseInt(dob.month, 10);
    const year = parseInt(dob.year, 10);
    const countryCode = (country || '').toUpperCase();

    if (!day || !month || !year || !countryCode) {
        throw new HttpsError('invalid-argument', 'Date of birth and country are required.');
    }

    // Validate date is real
    const testDate = new Date(year, month - 1, day);
    if (
        testDate.getDate() !== day ||
        testDate.getMonth() !== month - 1 ||
        testDate.getFullYear() !== year
    ) {
        throw new HttpsError('invalid-argument', 'Invalid date of birth.');
    }

    // Prevent future dates
    if (testDate > new Date()) {
        throw new HttpsError('invalid-argument', 'Date of birth cannot be in the future.');
    }

    const age = calculateAge(day, month, year);
    const minimumAge = await getMinimumSocialMediaAge(countryCode);

    if (age < minimumAge) {
        return {
            success: false,
            reason: `You must be at least ${minimumAge} years old to use social features in your country.`,
            country: countryCode,
            age,
            minimumAge
        };
    }

    const uid = request.auth.uid;

    // Set custom claim on main project
    try {
        const userRecord = await admin.auth().getUser(uid);
        await admin.auth().setCustomUserClaims(uid, {
            ...(userRecord.customClaims || {}),
            ageVerified: true,
            ageVerifiedAt: Date.now(),
            ageVerificationCountry: countryCode,
            ageVerificationThreshold: age,
            ageVerificationMethod: 'self_declaration',
        });
    } catch (e) {
        logger.error('Failed to set ageVerified claim on main project:', e);
        throw new HttpsError('internal', 'Failed to update user verification status.');
    }

    // Set custom claim on social project (merge existing moderator/pro claims)
    if (socialAdminApp) {
        try {
            let existingSocialClaims = {};
            try {
                const socialRecord = await socialAdminApp.auth().getUser(uid);
                existingSocialClaims = socialRecord.customClaims || {};
            } catch (lookupErr) {
                if (!lookupErr.code || lookupErr.code !== 'auth/user-not-found') throw lookupErr;
            }
            await socialAdminApp.auth().setCustomUserClaims(uid, {
                ...existingSocialClaims,
                ageVerified: true,
                ageVerifiedAt: Date.now(),
                ageVerificationCountry: countryCode,
                ageVerificationThreshold: age,
                ageVerificationMethod: 'self_declaration',
            });
        } catch (e) {
            logger.error('Failed to set ageVerified claim on social project:', e);
        }
    }

    // Store verification metadata in Firestore for audit
    try {
        await admin.firestore().collection('users').doc(uid).collection('ageVerification').doc('latest').set({
            verified: true,
            country: countryCode,
            ageThreshold: age,
            minimumAge,
            dobDay: day,
            dobMonth: month,
            dobYear: year,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            method: 'self_declaration',
        });
    } catch (e) {
        logger.warn('Failed to store age verification metadata:', e.message);
    }

    return {
        success: true,
        country: countryCode,
        age,
        minimumAge
    };
});

/**
 * DEPRECATED: Start an AgeVerif OAuth2 verification session.
 * AgeVerif integration has been removed. Returns an error directing users to the new flow.
 */
exports.startAgeVerification = onCall(callOptions, async (request) => {
    throw new HttpsError('failed-precondition', 'AgeVerif integration has been removed. Please use the self-declaration form.');
});

/**
 * DEPRECATED: Complete an AgeVerif OAuth2 verification.
 * AgeVerif integration has been removed. Returns an error directing users to the new flow.
 */
exports.completeAgeVerification = onCall(callOptions, async (request) => {
    throw new HttpsError('failed-precondition', 'AgeVerif integration has been removed. Please use the self-declaration form.');
});

/**
 * DEPRECATED: Verify age via AgeVerif JWT.
 * AgeVerif integration has been removed. Returns an error directing users to the new flow.
 */
exports.verifyAge = onCall(callOptions, async (request) => {
    throw new HttpsError('failed-precondition', 'AgeVerif integration has been removed. Please use the self-declaration form.');
});

/*
 * IMAP Auth & List
 * Expects data: { 
 *   imap: { host, port, secure, auth: { user, pass } }, 
 *   path: "INBOX", 
 *   range: "1:10" (optional, default last 20) 
 * }
 */
/*
 * IMAP Auth & List
 * Expects data: { 
 *   imap: { ... }, 
 *   path: "INBOX", 
 *   cursor: 100 (optional, fetch emails BEFORE this sequence number),
 *   limit: 20 (optional, default 20)
 * }
 */
exports.fetchEmails = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');

    const { imap: imapConfig, path = 'INBOX', cursor, limit = 20 } = request.data || {};

    if (!imapConfig) {
        throw new HttpsError('invalid-argument', 'Missing IMAP configuration');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');

    const safePath = typeof path === 'string' && path ? path.substring(0, 200) : 'INBOX';
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const safeCursor = Number(cursor) > 0 ? Number(cursor) : null;

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();

        let lock = await client.getMailboxLock(safePath);
        try {
            const status = await client.status(safePath, { messages: true });
            const total = status.messages;

            if (total === 0) {
                return { success: true, messages: [], nextCursor: null };
            }

            // Calculate range
            // If cursor is provided, we fetch ending at cursor - 1
            // If not provided, we fetch ending at total
            let endObj = safeCursor ? Math.max(1, safeCursor - 1) : total;
            let startObj = Math.max(1, endObj - safeLimit + 1);

            if (endObj < 1) {
                return { success: true, messages: [], nextCursor: null };
            }

            const fetchRange = `${startObj}:${endObj}`;
            const messages = [];

            // fetch headers and body preview (snippet)
            // Fetching 'body[1.MIME]' or similar is tricky across servers. 
            // We'll try fetching the structure and a small part of the body.
            // Using 'source' with maxLength is supported by ImapFlow for partial fetch.
            // We want the snippet to be text.

            for await (let message of client.fetch(fetchRange, { envelope: true, source: { maxLength: 1024 }, flags: true, internalDate: true })) {
                let snippet = "";
                try {
                    // Quick parse of the potentially partial source to get some text
                    // Simplistic: just try to parse what we got
                    if (message.source) {
                        const parsed = await simpleParser(message.source);
                        snippet = parsed.text ? parsed.text.substring(0, 100).replace(/\s+/g, ' ').trim() : "";
                    }
                } catch (e) {
                    // Ignore parse errors on partial content
                }

                messages.push({
                    uid: message.uid,
                    seq: message.seq,
                    envelope: {
                        ...message.envelope,
                        date: message.envelope.date ? message.envelope.date.toISOString() : null
                    },
                    flags: Array.from(message.flags),
                    internalDate: message.internalDate ? message.internalDate.toISOString() : null,
                    snippet: snippet
                });
            }

            messages.reverse(); // Newest first

            return {
                success: true,
                messages,
                nextCursor: startObj > 1 ? startObj : null
            };

        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("IMAP Error", err);
        throw new HttpsError('internal', "Could not read mail from the server.");
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});


/*
 * IMAP search. The client uses this instead of filtering the 20 loaded rows.
 * Query is capped and results are limited so a broad search cannot return the
 * whole mailbox in one callable response.
 */
exports.searchEmails = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');
    const { imap: imapConfig, path = 'INBOX', query, limit = 30 } = request.data || {};

    if (!imapConfig || !query || !String(query).trim()) {
        throw new HttpsError('invalid-argument', 'Missing IMAP config or search query.');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');
    const safePath = typeof path === 'string' && path ? path.substring(0, 200) : 'INBOX';
    const safeQuery = String(query).trim().slice(0, 200);
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 30));

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();
        const lock = await client.getMailboxLock(safePath);
        try {
            let uids;
            try {
                uids = await client.search({
                    or: [
                        { subject: safeQuery },
                        { from: safeQuery },
                        { text: safeQuery }
                    ]
                }, { uid: true });
            } catch (searchErr) {
                // Some IMAP servers do not implement TEXT; fall back to headers.
                uids = await client.search({ subject: safeQuery }, { uid: true });
            }

            if (!uids || uids.length === 0) {
                return { success: true, messages: [], query: safeQuery };
            }

            const selected = uids.slice(-safeLimit);
            const messages = [];
            for await (const message of client.fetch(selected.join(','), {
                envelope: true,
                source: { maxLength: 1024 },
                flags: true,
                internalDate: true
            }, { uid: true })) {
                let snippet = '';
                try {
                    if (message.source) {
                        const parsed = await simpleParser(message.source);
                        snippet = parsed.text ? parsed.text.substring(0, 100).replace(/\s+/g, ' ').trim() : '';
                    }
                } catch (e) { }
                messages.push({
                    uid: message.uid,
                    seq: message.seq,
                    envelope: {
                        ...message.envelope,
                        date: message.envelope.date ? message.envelope.date.toISOString() : null
                    },
                    flags: Array.from(message.flags),
                    internalDate: message.internalDate ? message.internalDate.toISOString() : null,
                    snippet: snippet
                });
            }

            messages.sort((a, b) => new Date(b.envelope.date || b.internalDate) - new Date(a.envelope.date || a.internalDate));
            return { success: true, messages: messages, query: safeQuery };
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error('IMAP Search Error', err);
        if (err instanceof HttpsError) throw err;
        throw new HttpsError('internal', 'Could not search the mailbox.');
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});

exports.moveEmail = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');

    const { imap: imapConfig, path, uid, destination } = request.data || {};
    if (!imapConfig || !uid || !destination) {
        throw new HttpsError('invalid-argument', 'Missing IMAP config, UID, or destination.');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');

    const safePath = typeof path === 'string' && path ? path.substring(0, 200) : 'INBOX';
    const safeDestination = String(destination).substring(0, 200);

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock(safePath);
        try {
            await client.messageMove(String(uid), safeDestination, { uid: true });
            return { success: true };
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("Move Error", err);
        throw new HttpsError('internal', "Could not move the message.");
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});

exports.modifyFlags = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');

    const { imap: imapConfig, path, uid, addFlags, removeFlags } = request.data || {};
    if (!imapConfig || !uid) {
        throw new HttpsError('invalid-argument', 'Missing IMAP config or UID.');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');

    const safePath = typeof path === 'string' && path ? path.substring(0, 200) : 'INBOX';
    const safeAdd = Array.isArray(addFlags) ? addFlags.slice(0, 20).map(f => String(f).substring(0, 40)) : [];
    const safeRemove = Array.isArray(removeFlags) ? removeFlags.slice(0, 20).map(f => String(f).substring(0, 40)) : [];

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock(safePath);
        try {
            if (safeAdd.length) {
                await client.messageFlagsAdd(String(uid), safeAdd, { uid: true });
            }
            if (safeRemove.length) {
                await client.messageFlagsRemove(String(uid), safeRemove, { uid: true });
            }
            return { success: true };
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("Flag Error", err);
        throw new HttpsError('internal', "Could not update message flags.");
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});

/*
 * IMAP Fetch Email Body
 * Expects data: { 
 *   imap: { ... }, 
 *   path: "INBOX", 
 *   uid: "123" 
 * }
 */
exports.fetchEmailBody = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');

    const { imap: imapConfig, path = 'INBOX', uid } = request.data || {};

    if (!imapConfig || !uid) {
        throw new HttpsError('invalid-argument', 'Missing IMAP config or UID');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');

    const safePath = typeof path === 'string' && path ? path.substring(0, 200) : 'INBOX';

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock(safePath);
        try {
            // client.fetch returns a generator, iterate to get the message
            // Convert UID to string to ensure it's treated as a UID range if numeric
            const uidStr = String(uid);
            let message;

            try {
                message = await client.fetchOne(uidStr, { source: true, uid: true });
            } catch (e) {
                logger.warn("fetchOne failed, falling back to sequence search:", e.message);
            }

            if (!message) {
                // Try searching for the sequence number first as a fallback
                const seq = await client.search({ uid: uidStr });
                if (seq && seq.length > 0) {
                    message = await client.fetchOne(seq[0], { source: true });
                }
            }

            if (!message) {
                throw new HttpsError('not-found', "Message not found for UID: " + uidStr + " in folder: " + safePath);
            }

            const parsed = await simpleParser(message.source);

            // html cleaning logic
            let cleanedHtml = parsed.html;
            if (cleanedHtml) {
                // 1. Remove empty paragraphs/divs frequently used as spacers
                cleanedHtml = cleanedHtml.replace(/<(p|div)[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '');
                // 2. Collapse multiple breaks into single break
                cleanedHtml = cleanedHtml.replace(/(<br\s*\/?>\s*)+/gi, '<br>');
            }

            return {
                success: true,
                email: {
                    subject: parsed.subject,
                    from: parsed.from,
                    to: parsed.to,
                    date: parsed.date ? parsed.date.toISOString() : null,
                    text: parsed.text,
                    html: cleanedHtml,
                    attachments: (parsed.attachments || []).map((a, index) => ({
                        index: index,
                        filename: a.filename || ('attachment-' + (index + 1)),
                        contentType: a.contentType || 'application/octet-stream',
                        size: a.size || (a.content ? a.content.length : 0)
                    }))
                }
            };

        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("IMAP Body Error", err);
        if (err instanceof HttpsError) throw err;
        throw new HttpsError('internal', "Could not load the message.");
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});


/*
 * Download one attachment from a message. The body fetch returns metadata only;
 * attachment bytes are fetched on demand and capped so a single callable cannot
 * return an unbounded blob.
 */
exports.fetchEmailAttachment = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');
    const { imap: imapConfig, path = 'INBOX', uid, index } = request.data || {};

    if (!imapConfig || !uid || index === undefined) {
        throw new HttpsError('invalid-argument', 'Missing IMAP config, UID or attachment index.');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');
    const safePath = typeof path === 'string' && path ? path.substring(0, 200) : 'INBOX';
    const attachmentIndex = Number(index);
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
        throw new HttpsError('invalid-argument', 'Invalid attachment index.');
    }

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();
        const lock = await client.getMailboxLock(safePath);
        try {
            const message = await client.fetchOne(String(uid), { source: true, uid: true });
            if (!message || !message.source) {
                throw new HttpsError('not-found', 'Message not found.');
            }
            const parsed = await simpleParser(message.source);
            const attachment = (parsed.attachments || [])[attachmentIndex];
            if (!attachment || !attachment.content) {
                throw new HttpsError('not-found', 'Attachment not found.');
            }
            const content = attachment.content;
            if (content.length > 6 * 1024 * 1024) {
                throw new HttpsError('resource-exhausted', 'This attachment is too large to download here.');
            }
            return {
                success: true,
                filename: attachment.filename || ('attachment-' + (attachmentIndex + 1)),
                contentType: attachment.contentType || 'application/octet-stream',
                data: content.toString('base64')
            };
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error('IMAP Attachment Error', err);
        if (err instanceof HttpsError) throw err;
        throw new HttpsError('internal', 'Could not download the attachment.');
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});

/*
 * SMTP Send Email
 * Expects data: {
 *   smtp: { host, port, secure, auth: { user, pass } },
 *   message: { from, to, subject, text, html }
 * }
 */
async function appendSentCopy(uid, imapConfig, rawMessage) {
    const conn = await resolveMailConnection(uid, imapConfig, 'imap');
    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false,
        socketTimeout: 10000,
        greetingTimeout: 10000
    });
    try {
        await client.connect();
        const folders = await client.list();
        const sent = folders.find(f => f.specialUse === '\\Sent') ||
            folders.find(f => /^sent(\s|$)/i.test(f.name || ''));
        if (!sent) return false;
        await client.append(sent.path, rawMessage, ['\\Seen']);
        return true;
    } finally {
        if (client) await client.logout().catch(() => { });
    }
}

exports.sendEmail = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'smtp');

    const { smtp: smtpConfig, imap: imapConfig, message } = request.data || {};

    if (!smtpConfig || !message) {
        throw new HttpsError('invalid-argument', 'Missing SMTP config or message');
    }
    const conn = await resolveMailConnection(auth.uid, smtpConfig, 'smtp');

    const recipients = Array.isArray(message.to) ? message.to.join(',') : String(message.to || '');
    if (!recipients.trim() || recipients.split(',').length > 10) {
        throw new HttpsError('invalid-argument', 'Invalid recipient list.');
    }
    if (String(message.subject || '').length > 200) {
        throw new HttpsError('invalid-argument', 'Subject is too long.');
    }
    if (String(message.text || '').length + String(message.html || '').length > 1024 * 1024) {
        throw new HttpsError('invalid-argument', 'Message is too large.');
    }

    const attachments = [];
    if (Array.isArray(message.attachments) && message.attachments.length) {
        if (message.attachments.length > 3) {
            throw new HttpsError('invalid-argument', 'Too many attachments (maximum 3).');
        }
        let totalBytes = 0;
        for (const att of message.attachments) {
            if (!att || typeof att.data !== 'string' || !att.data) {
                throw new HttpsError('invalid-argument', 'Invalid attachment.');
            }
            const filename = String(att.filename || 'attachment').replace(/[\r\n]/g, '').slice(0, 180);
            const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(String(att.contentType || ''))
                ? String(att.contentType)
                : 'application/octet-stream';
            const content = Buffer.from(att.data, 'base64');
            if (!content.length) {
                throw new HttpsError('invalid-argument', 'Invalid attachment data.');
            }
            totalBytes += content.length;
            if (totalBytes > 4 * 1024 * 1024) {
                throw new HttpsError('invalid-argument', 'Attachments must total 4 MB or less.');
            }
            attachments.push({ filename: filename, content: content, contentType: contentType });
        }
    }

    const transporter = nodemailer.createTransport({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        // Microsoft SMTP (587) only offers STARTTLS; require it for OAuth so
        // the bearer token can never be sent over a downgraded connection.
        requireTLS: conn.requireTLS === true
    });

    try {
        const info = await transporter.sendMail({
            from: message.from || conn.auth.user,
            to: recipients,
            subject: message.subject,
            text: message.text,
            html: message.html,
            attachments: attachments
        });

        // Best-effort copy into the Sent folder. A failed append must never
        // make the user think the message was not sent.
        let sentCopy = false;
        if (imapConfig) {
            try {
                const composer = new MailComposer({
                    from: message.from || conn.auth.user,
                    to: recipients,
                    subject: message.subject,
                    text: message.text,
                    html: message.html,
                    attachments: attachments
                });
                const raw = await new Promise(function (resolve, reject) {
                    composer.compile().build(function (err, buf) {
                        if (err) reject(err); else resolve(buf);
                    });
                });
                sentCopy = await appendSentCopy(auth.uid, imapConfig, raw);
            } catch (appendErr) {
                logger.warn('Could not append sent copy', appendErr);
            }
        }

        return { success: true, messageId: info.messageId, sentCopy: sentCopy };
    } catch (err) {
        logger.error("SMTP Error", err);
        throw new HttpsError('internal', "Could not send the email.");
    }
});

/*
 * IMAP List Folders
 * Expects data: {
 *   imap: { ... }
 * }
 */
exports.getFolders = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'imap');

    const { imap: imapConfig } = request.data || {};

    if (!imapConfig) {
        throw new HttpsError('invalid-argument', 'Missing IMAP configuration');
    }
    const conn = await resolveMailConnection(auth.uid, imapConfig, 'imap');

    const client = new ImapFlow({
        host: conn.host,
        port: conn.port,
        secure: conn.secure,
        auth: conn.auth,
        logger: false
    });

    try {
        await client.connect();

        const folders = await client.list();

        // Return simplified list
        return {
            success: true,
            folders: folders.map(f => ({
                path: f.path,
                name: f.name,
                delimiter: f.delimiter,
                specialUse: f.specialUse,
                flags: Array.from(f.flags || [])
            }))
        };
    } catch (err) {
        // A rejected login (revoked app password, dead Outlook token) is something
        // the user can fix; a transport failure is not. Both used to surface as the
        // same opaque message, which read like a ReKindle bug.
        const message = String((err && err.message) || '');
        const authFailed = !!err && (err.authenticationFailed === true
            || /authenticate|authentication|login failed|invalid credentials|not authenticated/i.test(message));
        // `error`, not `message`: the structured logger treats `message` as the
        // log line itself and would replace this line's text with it.
        logger.error('IMAP folder open failed', {
            error: message,
            authFailed: authFailed,
            host: conn.host,
            user: conn.auth && conn.auth.user ? String(conn.auth.user).replace(/(^.)(.*)(@.*)$/, '$1***$3') : null,
            oauth: !!(conn.auth && conn.auth.accessToken)
        });
        throw new HttpsError('internal', authFailed
            ? "The mail server rejected this account's login. Re-add it, or check its app password."
            : "Could not list mail folders.");
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});

/**
 * Can this address open its mailbox with that access token?
 *
 * A Microsoft account's sign-in identity is whatever address the user chose —
 * it can be a Gmail address — while the mailbox has its own primary SMTP
 * address (`timjarnott@gmail.com` signing in to `tim.biscuits@hotmail.com`).
 * IMAP authenticates the *mailbox* address, so the two must not be conflated.
 */
async function canOpenOutlookMailbox(address, accessToken) {
    const client = new ImapFlow({
        host: mailOAuth.MICROSOFT_IMAP.host,
        port: mailOAuth.MICROSOFT_IMAP.port,
        secure: true,
        auth: { user: address, accessToken },
        logger: false,
        greetingTimeout: 8000,
        socketTimeout: 15000
    });
    try {
        await client.connect();
        return true;
    } catch (e) {
        // `message` is reserved by the structured logger and replaced the line
        // above it, hiding the reason; log it as `error`.
        logger.info('Outlook mailbox probe failed', { address, error: e.message });
        return false;
    } finally {
        await client.logout().catch(() => { });
    }
}

/**
 * Outlook / Hotmail: begin a device-code sign-in.
 *
 * The Kindle cannot complete Microsoft's sign-in page (it is a JS-only app with
 * no form fallback), so the user enters the returned code on a phone/computer.
 * The device code itself stays server-side in `mail_oauth_pending/{uid}`
 * (default-deny), so a leaked response cannot attach a mailbox to another
 * ReKindle account. Returns { userCode, verificationUri, expiresIn, interval }.
 */
exports.mailMicrosoftStart = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'oauth');

    const clientId = mailOAuth.microsoftClientId();
    if (!clientId) {
        throw new HttpsError('failed-precondition', 'Outlook sign-in is not configured yet.');
    }

    const { ok, json } = await msPostForm(mailOAuth.microsoftDeviceCodeUrl(), {
        client_id: clientId,
        scope: mailOAuth.microsoftScopes()
    });

    if (!ok || !json.device_code) {
        logger.error('Microsoft device code request failed', {
            status: json.status, error: json.error, desc: json.error_description
        });
        throw new HttpsError('internal', 'Could not start Outlook sign-in.');
    }

    const interval = Math.max(5, Number(json.interval) || 5);
    const expiresIn = Number(json.expires_in) || 900;

    await admin.database().ref(`${MS_PENDING_PATH}/${auth.uid}`).set({
        deviceCode: json.device_code,
        emailHint: String((request.data && request.data.email) || '').slice(0, 320),
        createdAt: Date.now(),
        expiresAt: Date.now() + expiresIn * 1000
    });

    return {
        success: true,
        userCode: json.user_code,
        verificationUri: json.verification_uri || 'https://microsoft.com/devicelogin',
        expiresIn,
        interval
    };
});

/**
 * Outlook / Hotmail: poll the pending device code once.
 *
 * Returns { status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'error' |
 * 'ok', email? }. The client calls this every `interval` seconds. On 'ok' the
 * refresh token is stored in `mail_oauth/{uid}` and the account is mirrored
 * into the client-readable `users/{uid}/pro_data/mail` doc (password fields
 * removed) so other devices can restore it.
 */
exports.mailMicrosoftPoll = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'none');

    const clientId = mailOAuth.microsoftClientId();
    if (!clientId) {
        throw new HttpsError('failed-precondition', 'Outlook sign-in is not configured yet.');
    }

    const pendingRef = admin.database().ref(`${MS_PENDING_PATH}/${auth.uid}`);
    const snap = await pendingRef.get();
    const pending = snap.exists() ? snap.val() : null;

    if (!pending || !pending.deviceCode) {
        return { success: true, status: 'expired' };
    }
    if (pending.expiresAt && pending.expiresAt < Date.now()) {
        await pendingRef.remove().catch(() => { });
        return { success: true, status: 'expired' };
    }

    const { ok, json } = await msPostForm(mailOAuth.microsoftTokenUrl(), {
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: pending.deviceCode
    });

    if (!ok) {
        const code = String(json.error || '');
        if (code === 'authorization_pending') {
            return { success: true, status: 'pending' };
        }
        if (code === 'slow_down') {
            return { success: true, status: 'slow_down' };
        }
        if (code === 'expired_token' || code === 'code_expired' || code === 'bad_verification_code') {
            await pendingRef.remove().catch(() => { });
            return { success: true, status: 'expired' };
        }
        if (code === 'authorization_declined' || code === 'access_denied') {
            await pendingRef.remove().catch(() => { });
            return { success: true, status: 'denied' };
        }
        logger.warn('Microsoft device-code poll failed', {
            uid: auth.uid, code, desc: json.error_description
        });
        // consent_required: a work/school tenant admin has to approve the app.
        return { success: true, status: code === 'consent_required' ? 'consent' : 'error' };
    }

    const idPayload = json.id_token ? decodeJwtPayload(json.id_token) : null;
    const signInEmail = String(
        (idPayload && (idPayload.preferred_username || idPayload.email)) || ''
    ).trim();

    if (!json.refresh_token) {
        logger.warn('Microsoft device-code success without a refresh token', { uid: auth.uid });
        return { success: true, status: 'error' };
    }

    // Try the address the user typed first, then the sign-in identity. Only an
    // address that actually opens the mailbox is safe to store: storing the
    // sign-in identity made every later folder/message call fail with "the mail
    // server rejected this account's login".
    const candidates = [];
    [pending.emailHint, signInEmail].forEach(value => {
        const clean = String(value || '').trim();
        if (clean && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)
            && candidates.map(c => c.toLowerCase()).indexOf(clean.toLowerCase()) === -1) {
            candidates.push(clean);
        }
    });

    // The probe is advisory. Blocking on it bricked a flow that had been working,
    // and its failure was invisible to the user - so save the address the user
    // typed (else the sign-in identity) and let the first real call decide. The
    // probe result still goes to the log, which is where the reason belongs.
    let email = null;
    let verified = false;
    for (const candidate of candidates) {
        if (await canOpenOutlookMailbox(candidate, json.access_token)) {
            email = candidate;
            verified = true;
            break;
        }
    }

    if (!email) {
        email = candidates[0] || signInEmail || '';
    }

    if (!email) {
        await pendingRef.remove().catch(() => { });
        logger.warn('Outlook sign-in succeeded without any usable address', { uid: auth.uid, candidates });
        return { success: true, status: 'error' };
    }

    if (!verified) {
        logger.warn('Outlook mailbox probe did not authenticate; saving the typed address anyway', {
            uid: auth.uid, candidates, saved: email
        });
    }

    // Re-running the flow for a mailbox that is already linked refreshes its
    // token instead of adding a duplicate account entry.
    const existingSnap = await admin.database().ref(`${MS_ACCOUNT_PATH}/${auth.uid}`).get();
    const existing = existingSnap.exists() ? (existingSnap.val() || {}) : {};
    let accountId = null;
    Object.keys(existing).forEach(id => {
        const entry = existing[id];
        if (!accountId && entry && String(entry.email || '').toLowerCase() === email.toLowerCase()) {
            accountId = id;
        }
    });
    if (!accountId) {
        accountId = 'ms' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    await admin.database().ref(`${MS_ACCOUNT_PATH}/${auth.uid}/${accountId}`).set({
        provider: 'microsoft',
        email,
        refreshToken: json.refresh_token,
        updatedAt: Date.now()
    });
    await pendingRef.remove().catch(() => { });
    msTokenCache.delete(`${auth.uid}:${accountId}`);

    // The account list itself lives in the client-readable settings doc, which
    // mail.html owns; the server only ever stores the refresh token.
    return { success: true, status: 'ok', email, accountId, verified };
});

/**
 * Outlook / Hotmail: which mailboxes are linked? Never returns refresh tokens.
 */
exports.mailMicrosoftStatus = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'none');

    const snap = await admin.database().ref(`${MS_ACCOUNT_PATH}/${auth.uid}`).get();
    const all = snap.exists() ? (snap.val() || {}) : {};
    const accounts = Object.keys(all)
        .filter(id => all[id] && all[id].refreshToken)
        .map(id => ({ id, email: all[id].email || null }));

    return { success: true, accounts, linked: accounts.length > 0 };
});

/**
 * Outlook / Hotmail: forget one linked mailbox, or every mailbox for this user.
 *
 * Removes the refresh token only; mail.html drops the account entry itself.
 * Other devices keep a stale entry, which then reports "connection expired".
 */
exports.mailMicrosoftDisconnect = onCall(callOptions, async (request) => {
    const auth = await assertMailAccess(request, 'none');
    const rawId = request.data && request.data.accountId;
    const accountId = typeof rawId === 'string' ? rawId.trim() : '';

    if (accountId) {
        await admin.database().ref(`${MS_ACCOUNT_PATH}/${auth.uid}/${accountId}`).remove();
        msTokenCache.delete(`${auth.uid}:${accountId}`);
    } else {
        const snap = await admin.database().ref(`${MS_ACCOUNT_PATH}/${auth.uid}`).get();
        const all = snap.exists() ? (snap.val() || {}) : {};
        Object.keys(all).forEach(id => msTokenCache.delete(`${auth.uid}:${id}`));
        await admin.database().ref(`${MS_ACCOUNT_PATH}/${auth.uid}`).remove();
    }
    await admin.database().ref(`${MS_PENDING_PATH}/${auth.uid}`).remove().catch(() => { });

    return { success: true };
});

/**
 * Server-side registration with IP ban enforcement.
 * Because this runs on Google's servers, the IP is read from the actual HTTP
 * request — the client cannot spoof or bypass it with browser dev tools.
 *
 * Expects: { username: string, password: string }
 * Returns: { customToken: string } — client signs in with signInWithCustomToken()
 */
exports.registerUser = onCall(callOptions, async (request) => {
    const { username, password } = request.data;

    // Basic input validation (mirrors the client-side checks)
    if (!username || !password) {
        throw new HttpsError('invalid-argument', 'Username and password are required.');
    }
    if (username.length > 20) {
        throw new HttpsError('invalid-argument', 'Username must be 20 characters or less.');
    }
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
        throw new HttpsError('invalid-argument', 'Username can only contain letters and numbers.');
    }
    // Banned competitor names (KindleHub / kindlehub.pro / Unreader / InkChat)
    // cannot be used as usernames - the client check is bypassable, so enforce
    // it here as well. Usernames are alphanumeric-only, so a plain lowercase
    // substring match is enough (no homoglyph folding needed).
    const lowerUsername = username.toLowerCase();
    if (["kindlehub", "khub", "unreader", "inkchat"].some((name) => lowerUsername.includes(name))) {
        throw new HttpsError('invalid-argument', 'That username is not allowed.');
    }

    // Get the real client IP from the server-side request
    let ip = '';
    try {
        const forwarded = request.rawRequest?.headers?.['x-forwarded-for'];
        const rawIp = (forwarded ? forwarded.split(',')[0].trim() : request.rawRequest?.ip) || '';
        // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
        ip = rawIp.replace(/^::ffff:/, '');
    } catch (ipErr) {
        logger.warn('Unable to extract client IP:', ipErr);
    }

    // Check banned IPs — this happens on the server, nothing the client can bypass
    if (ip) {
        try {
            const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
            const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
            if (snap.exists()) {
                logger.warn(`Blocked registration from banned IP: ${ip} (username attempt: ${username})`);
                await logModAction('ip_ban_registration', '', username, `Blocked registration from banned IP: ${ip}`);
                throw new HttpsError('permission-denied', 'Registration is not available from your network.');
            }
        } catch (e) {
            if (e.code && e.code.startsWith('functions/')) throw e; // re-throw HttpsError
            logger.error('Banned IP check error:', e);
            // Don't block registration on a transient DB read failure
        }
    }

    // Create the account
    const email = `${username}@rekindle.ink`;
    let userRecord;
    try {
        userRecord = await admin.auth().createUser({ email, password });
    } catch (e) {
        if (e.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'That username is already taken.');
        }
        if (e.code === 'auth/weak-password') {
            throw new HttpsError('invalid-argument', 'Password is too weak.');
        }
        logger.error('createUser error:', e);
        throw new HttpsError('internal', 'Registration failed. Please try again.');
    }

    // Everything after createUser is wrapped so a partial failure doesn't leave
    // the client with a confusing 500 and no actionable error.
    try {
        // Store IP server-side immediately — reliable regardless of client behaviour
        if (ip) {
            await admin.database().ref(`users_private/${userRecord.uid}/ipAddress`).set(ip);
        }

        // Post-creation defence-in-depth: if the IP was banned in the race window
        // between the pre-check and createUser, disable the account immediately.
        if (ip) {
            const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
            const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
            if (snap.exists()) {
                logger.warn(`Banned IP registered (race) — disabling account: ${ip} (uid: ${userRecord.uid})`);
                await admin.auth().updateUser(userRecord.uid, { disabled: true });
                await logModAction('ip_ban_login', userRecord.uid, username, `Account disabled after registration from banned IP: ${ip}`);
                throw new HttpsError('permission-denied', 'Registration is not available from your network.');
            }
        }

        // Create public profile so moderation search can find the user immediately
        const avatarSeed = Math.floor(Math.random() * 10000);
        await admin.database().ref(`users_public/${userRecord.uid}`).set({
            username: username,
            email: email,
            avatarSeed: avatarSeed,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            lastActive: admin.database.ServerValue.TIMESTAMP
        });
        // Also create user_cards mirror for fast avatar lookups
        await admin.database().ref(`user_cards/${userRecord.uid}`).set({
            username: username,
            avatarSeed: avatarSeed,
            customAvatar: null
        });

        // Return a custom token so the client can call signInWithCustomToken()
        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        return { customToken };
    } catch (e) {
        if (e.code && e.code.startsWith('functions/')) throw e; // re-throw HttpsError
        logger.error('Post-registration error for uid:', userRecord.uid, e);
        throw new HttpsError('internal', 'Please log in with your username and password.');
    }
});

/**
 * Called by the client immediately after signInWithEmailAndPassword succeeds.
 * Checks the real server-side IP against the banned list and, if banned, disables
 * the Firebase Auth account and revokes all refresh tokens so the session can't persist.
 *
 * Returns: { banned: boolean }
 */
exports.getUserAuthStatus = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const { uid } = request.data;
    if (!uid) {
        throw new HttpsError('invalid-argument', 'Missing uid.');
    }

    const callerUid = request.auth.uid;
    const callerRecord = await admin.auth().getUser(callerUid);
    const isAdmin = callerRecord.email === 'ukiyo@rekindle.ink';
    // Owner-only: the moderation console is the only caller, and account
    // status is not something a volunteer moderator needs to probe.
    if (!isAdmin) {
        throw new HttpsError('permission-denied', 'Admin access required.');
    }

    try {
        const userRecord = await admin.auth().getUser(uid);
        return { disabled: userRecord.disabled };
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            return { disabled: null, notFound: true };
        }
        logger.error('getUserAuthStatus error:', e);
        throw new HttpsError('internal', 'Failed to fetch user auth status: ' + e.message);
    }
});

exports.setUserAuthStatus = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const { uid, disabled } = request.data;
    if (!uid || typeof disabled !== 'boolean') {
        throw new HttpsError('invalid-argument', 'Missing uid or disabled flag.');
    }

    const callerUid = request.auth.uid;
    const callerRecord = await admin.auth().getUser(callerUid);
    const isAdmin = callerRecord.email === 'ukiyo@rekindle.ink';
    if (!isAdmin) {
        throw new HttpsError('permission-denied', 'Admin access required.');
    }

    try {
        await admin.auth().updateUser(uid, { disabled });
        return { success: true, disabled };
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'User not found.');
        }
        logger.error('setUserAuthStatus error:', e);
        throw new HttpsError('internal', 'Failed to update user auth status: ' + e.message);
    }
});

exports.getSocialUserAuthStatus = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const { uid } = request.data;
    if (!uid) {
        throw new HttpsError('invalid-argument', 'Missing uid.');
    }

    const callerUid = request.auth.uid;
    const callerRecord = await admin.auth().getUser(callerUid);
    const isAdmin = callerRecord.email === 'ukiyo@rekindle.ink';
    // Owner-only, matching getUserAuthStatus.
    if (!isAdmin) {
        throw new HttpsError('permission-denied', 'Admin access required.');
    }

    if (!socialAdminApp) {
        throw new HttpsError('failed-precondition', 'Social project not configured on server.');
    }

    try {
        const userRecord = await socialAdminApp.auth().getUser(uid);
        return { disabled: userRecord.disabled };
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            return { disabled: null, notFound: true };
        }
        logger.error('getSocialUserAuthStatus error:', e);
        throw new HttpsError('internal', 'Failed to fetch social user auth status: ' + e.message);
    }
});

exports.setSocialUserAuthStatus = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const { uid, disabled } = request.data;
    if (!uid || typeof disabled !== 'boolean') {
        throw new HttpsError('invalid-argument', 'Missing uid or disabled flag.');
    }

    const callerUid = request.auth.uid;
    const callerRecord = await admin.auth().getUser(callerUid);
    const isAdmin = callerRecord.email === 'ukiyo@rekindle.ink';
    if (!isAdmin) {
        throw new HttpsError('permission-denied', 'Admin access required.');
    }

    if (!socialAdminApp) {
        throw new HttpsError('failed-precondition', 'Social project not configured on server.');
    }

    try {
        await socialAdminApp.auth().updateUser(uid, { disabled });
        return { success: true, disabled };
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'User not found in social project.');
        }
        logger.error('setSocialUserAuthStatus error:', e);
        throw new HttpsError('internal', 'Failed to update social user auth status: ' + e.message);
    }
});

exports.checkIPOnLogin = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in to call this function.');
    }

    const uid = request.auth.uid;
    const forwarded = request.rawRequest.headers['x-forwarded-for'];
    const rawIp = (forwarded ? forwarded.split(',')[0].trim() : request.rawRequest.ip) || '';
    const ip = rawIp.replace(/^::ffff:/, '');

    if (ip) {
        const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
        const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
        if (snap.exists()) {
            logger.warn(`Banned IP signed in — disabling account and revoking session: ${ip} (uid: ${uid})`);
            await admin.auth().updateUser(uid, { disabled: true });
            await admin.auth().revokeRefreshTokens(uid);
            await logModAction('ip_ban_login', uid, uid, `Account disabled on login from banned IP: ${ip}`);
            return { banned: true };
        }
        // Keep stored IP current so ban-by-IP lookups stay accurate
        await admin.database().ref(`users_private/${uid}/ipAddress`).set(ip);
    }

    return { banned: false };
});



/**
 * Server-side posting to general chat with rate-limit enforcement.
 * Because this runs on Google's servers, the limit cannot be bypassed
 * via browser dev tools or userscripts.
 *
 * Expects: { text?: string, ...optionalFields }
 * Returns: { allowed: boolean, key?: string, retryAfter?: number }
 */
exports.getSocialToken = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    if (!socialAdminApp) {
        throw new HttpsError('failed-precondition', 'Social project not configured on server.');
    }

    const uid = request.auth.uid;

    // These three lookups are independent; they used to run in series on every
    // social page load, before the client could sign in to the social project.
    const needsVerifyDoc = request.auth.token.ageVerified !== true;
    const verifyPromise = needsVerifyDoc
        ? admin.firestore()
            .collection('users').doc(uid)
            .collection('ageVerification').doc('latest')
            .get()
            .catch(() => null)
        : Promise.resolve(null);

    const [modSnap, isPro, verifyDoc] = await Promise.all([
        admin.database().ref('moderators/' + uid).once('value'),
        isUserPro(uid, request.auth.token.email, request.auth.token),
        verifyPromise
    ]);
    const isModerator = modSnap.val() === true;

    // Age verification status from main project auth claims. Older Stripe
    // claim writes wiped this claim, so repair it lazily from the audit doc.
    let isAgeVerified = request.auth.token.ageVerified === true;
    if (!isAgeVerified && verifyDoc && verifyDoc.exists && verifyDoc.data().verified === true) {
        isAgeVerified = true;
        try {
            const userRecord = await admin.auth().getUser(uid);
            await admin.auth().setCustomUserClaims(uid, {
                ...(userRecord.customClaims || {}),
                ageVerified: true,
                ageVerifiedAt: Date.now(),
                ageVerificationCountry: verifyDoc.data().country || null,
                ageVerificationThreshold: verifyDoc.data().ageThreshold || null,
                ageVerificationMethod: 'self_declaration_repair'
            });
        } catch (repairErr) {
            logger.warn('getSocialToken: could not repair ageVerified claim:', repairErr.message);
        }
    }

    // Resolve email (needed by social RTDB rules)
    let email = request.auth.token.email;
    if (!email) {
        try {
            const userRecord = await admin.auth().getUser(uid);
            email = userRecord.email;
        } catch (e) {
            logger.warn('getSocialToken: could not resolve email for uid', uid, e.message);
        }
    }

    // Ensure the user record exists in the social project's auth system with
    // their email so they show up in the Firebase Console Authentication
    // section. This is cosmetic: do not block token minting on it.
    if (email) {
        socialAdminApp.auth().getUser(uid)
            .then((socialUser) => {
                if (socialUser.email !== email) {
                    return socialAdminApp.auth().updateUser(uid, { email });
                }
                return null;
            })
            .catch((e) => {
                if (e.code === 'auth/user-not-found') {
                    return socialAdminApp.auth().createUser({
                        uid,
                        email,
                        emailVerified: true
                    });
                }
                logger.warn('getSocialToken: failed to sync user to social project:', e.message);
                return null;
            })
            .catch((e) => {
                logger.warn('getSocialToken: social user sync failed:', e.message);
            });
    }

    // Generate custom token signed by the social project's service account
    const token = await socialAdminApp.auth().createCustomToken(uid, {
        moderator: isModerator,
        pro: isPro,
        ageVerified: isAgeVerified,
        email: email || null
    });

    return { token };
});

/**
 * Owner-only manual Pro grant / revoke (moderation.html).
 *
 * The console used to write users/{uid} straight from the browser. That failed
 * two ways: an account that has never saved a setting has no users/{uid}
 * document, which makes the write a CREATE - and the create rule had no owner
 * escape - and the `pro` custom claim (read by storage.rules) was never
 * updated. The Admin SDK can do both here, so the console calls this and only
 * falls back to a direct write if the function is unavailable.
 *
 * `type` matches the console dropdown: days | months | years | lifetime.
 * Durations are computed server-side so a wrong device clock cannot change the
 * term of a grant.
 */
exports.adminSetPro = onCall(callOptions, async (request) => {
    const auth = request.auth;
    if (!auth || auth.token.email !== 'ukiyo@rekindle.ink') {
        throw new HttpsError('permission-denied', 'Owner only.');
    }

    const data = request.data || {};
    const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
    if (!uid || uid.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uid)) {
        throw new HttpsError('invalid-argument', 'A Firebase uid is required.');
    }
    if (data.action !== 'grant' && data.action !== 'revoke') {
        throw new HttpsError('invalid-argument', 'action must be grant or revoke.');
    }

    // Never create a users/{uid} document for an account that does not exist.
    const userRecord = await admin.auth().getUser(uid).catch(() => null);
    if (!userRecord) throw new HttpsError('not-found', 'No Firebase Auth account for that uid.');

    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const before = await userRef.get();
    const isGrant = data.action === 'grant';
    let expiresAt = new Date();
    let subscriptionType = null;

    if (isGrant) {
        const type = data.type;
        if (type === 'lifetime') {
            subscriptionType = 'lifetime';
            expiresAt = new Date(Date.UTC(2100, 0, 1));
        } else {
            const amount = Number(data.amount);
            if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) {
                throw new HttpsError('invalid-argument', 'Amount must be a whole number between 1 and 1000.');
            }
            if (type !== 'days' && type !== 'months' && type !== 'years') {
                throw new HttpsError('invalid-argument', 'type must be days, months, years or lifetime.');
            }
            subscriptionType = 'manual';
            expiresAt = new Date();
            if (type === 'days') expiresAt.setUTCDate(expiresAt.getUTCDate() + amount);
            else if (type === 'months') expiresAt.setUTCMonth(expiresAt.getUTCMonth() + amount);
            else expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + amount);
        }
    }

    const fsExpiry = admin.firestore.Timestamp.fromDate(expiresAt);
    const userUpdate = { isPro: isGrant, proExpiresAt: fsExpiry };
    if (subscriptionType) userUpdate.subscriptionType = subscriptionType;
    await userRef.set(userUpdate, { merge: true });

    // config/supporters is an authorization source in firestore.rules, so it
    // must agree with the document (a revoke deletes the entry).
    let supportersSynced = false;
    if (userRecord.email) {
        const entry = {};
        entry[userRecord.email] = isGrant
            ? { expiresAt: fsExpiry, isLifetime: subscriptionType === 'lifetime' }
            : admin.firestore.FieldValue.delete();
        await db.collection('config').doc('supporters').set(entry, { merge: true });
        supportersSynced = true;
    }

    // Merge, never replace: setCustomUserClaims overwrites the whole object,
    // which is how Pro grants used to delete ageVerified/moderator.
    const mergedClaims = Object.assign({}, userRecord.customClaims || {}, { pro: isGrant });
    await admin.auth().setCustomUserClaims(uid, mergedClaims);

    logger.info('adminSetPro', {
        action: data.action,
        uid,
        expiresAt: expiresAt.toISOString(),
        createdDocument: !before.exists,
        by: auth.token.email
    });

    return {
        uid,
        isPro: isGrant,
        expiresAt: expiresAt.toISOString(),
        subscriptionType: subscriptionType || (before.exists ? before.get('subscriptionType') || null : null),
        email: userRecord.email || null,
        supportersSynced,
        createdDocument: !before.exists
    };
});

/**
 * Game leaderboards — server-authoritative score submission.
 *
 * The browser can no longer write `leaderboard_*` documents (firestore.rules
 * denies it). Games call startGameRun when the page opens and submitScore when
 * the run ends; the server bounds the claimed value by real elapsed time and a
 * per-game absolute maximum. See firebase-functions/scores.js + score-config.js.
 *
 * DEPLOY ORDER: functions first, then firestore.rules — otherwise scores stop
 * saving between the two deploys.
 */
const scoreHandlers = require("./scores");
exports.startGameRun = onCall(callOptions, scoreHandlers.startGameRun);
exports.submitScore = onCall(callOptions, scoreHandlers.submitScore);

/**
 * Permanent account deletion. See firebase-functions/account-deletion.js and
 * docs/agent/account-deletion.md. The longer timeout covers a full social +
 * personal data sweep; the Auth record is deleted last so a timeout is
 * retryable.
 */
const accountDeletion = require("./account-deletion");
exports.deleteAccount = onCall(
    Object.assign({}, callOptions, { timeoutSeconds: 540, memory: "512MiB" }),
    function (request) {
        return accountDeletion.deleteAccount(request, { socialApp: socialAdminApp });
    }
);

/**
 * resetForgottenPassword — change the password of the signed-in account
 * without the current password, for users who forgot it but still have a
 * session. Accounts have no real email address, so there is no reset link.
 * Guarded by a typed username, a strict password policy, a per-uid rate limit
 * and an audit entry. See firebase-functions/password-reset.js and
 * docs/agent/password-recovery.md.
 */
const passwordReset = require("./password-reset");
exports.resetForgottenPassword = onCall(callOptions, function (request) {
    return passwordReset.resetForgottenPassword(request);
});

/**
 * createRssFeed — Server-enforced RSS feed creation for free users.
 * Pro users write directly to Firestore (rules allow it); free users call this.
 *
 * Enforces: max 2 feeds, category forced to "Uncategorized" for free users.
 *
 * Expects: { name: string, url: string, category: string }
 * Returns: { success: true, id: string }
 */
exports.createRssFeed = onCall(callOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const uid = request.auth.uid;
    const email = request.auth.token.email || null;
    const { name, url, category } = request.data;

    // --- Validate URL ---
    if (!url || typeof url !== 'string') throw new HttpsError('invalid-argument', 'url is required.');
    try {
        const p = new URL(url);
        if (p.protocol !== 'http:' && p.protocol !== 'https:') throw new Error('bad protocol');
    } catch { throw new HttpsError('invalid-argument', 'Invalid URL.'); }

    const safeName = (typeof name === 'string' && name.trim()) ? name.trim().substring(0, 200) : 'New Feed';

    // --- Pro status check (mirrors firestore.rules isProUser()) ---
    const db = admin.firestore();
    let userIsPro = false;

    // 1. Developer check
    try {
        const rec = await admin.auth().getUser(uid);
        if (rec.email === 'ukiyo@rekindle.ink') userIsPro = true;
    } catch (e) { logger.warn('createRssFeed: getUser failed', e); }

    // 2. Legacy proExpiresAt on user document
    if (!userIsPro) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                const d = userDoc.data();
                if (d.proExpiresAt) {
                    const exp = d.proExpiresAt.toMillis ? d.proExpiresAt.toMillis() : new Date(d.proExpiresAt).getTime();
                    if (exp > Date.now()) userIsPro = true;
                }
            }
        } catch (e) { logger.warn('createRssFeed: proExpiresAt check failed', e); }
    }

    // 3. config/supporters by email (new source of truth)
    if (!userIsPro && email) {
        try {
            const sup = await db.collection('config').doc('supporters').get();
            if (sup.exists) {
                const d = sup.data();
                if (email in d && d[email] && d[email].expiresAt) {
                    const exp = d[email].expiresAt.toMillis ? d[email].expiresAt.toMillis() : new Date(d[email].expiresAt).getTime();
                    if (exp > Date.now()) userIsPro = true;
                }
            }
        } catch (e) { logger.warn('createRssFeed: supporters check failed', e); }
    }

    const feedsRef = db.collection('users').doc(uid).collection('rss_feeds');

    // --- Enforce 2-feed limit for free users ---
    const FREE_LIMIT = 2;
    if (!userIsPro) {
        const countSnap = await feedsRef.count().get();
        if (countSnap.data().count >= FREE_LIMIT) {
            throw new HttpsError('resource-exhausted', `Free accounts are limited to ${FREE_LIMIT} RSS feeds. Upgrade to ReKindle+ for unlimited feeds.`);
        }
    }

    // --- Duplicate URL check ---
    const dup = await feedsRef.where('url', '==', url).limit(1).get();
    if (!dup.empty) throw new HttpsError('already-exists', 'Already subscribed to this feed.');

    // --- Create feed (force Uncategorized for free users) ---
    const safeCategory = userIsPro
        ? (typeof category === 'string' && category.trim() ? category.trim() : 'Uncategorized')
        : 'Uncategorized';

    const docRef = await feedsRef.add({
        name: safeName,
        url,
        category: safeCategory,
        added: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`createRssFeed: uid=${uid} feed=${docRef.id} pro=${userIsPro}`);
    return { success: true, id: docRef.id };
});


// ---------------------------------------------------------------------------
// Standard Ebooks relay (reader.html's Standard Ebooks tab)
// standardebooks.org 403s every Cloudflare egress IP (AS132892), so /api/proxy
// cannot reach it. See firebase-functions/standardebooks.js.
// ---------------------------------------------------------------------------
const { standardEbooksHandler } = require("./standardebooks");

exports.standardebooks = onRequest(
    {
        region: "us-central1",
        memory: "256MiB",
        timeoutSeconds: 60,
        maxInstances: 5 // hard cost ceiling; idle cost is zero (no minInstances)
    },
    standardEbooksHandler
);

// ---------------------------------------------------------------------------
// Substack relay (substack.html)
// Substack 429s Cloudflare Worker egress, so the reader API is proxied from
// Google Cloud instead. See firebase-functions/substack.js.
// ---------------------------------------------------------------------------
const { substackHandler } = require("./substack");

exports.substack = onRequest(
    {
        region: "us-central1",
        memory: "256MiB",
        timeoutSeconds: 30,
        maxInstances: 10 // hard cost ceiling; idle cost is zero (no minInstances)
    },
    substackHandler
);

// ---------------------------------------------------------------------------
// Daily social-content retention (cleanupSocial)
//
// Deletes expired KindleChat messages/translations/art-index entries, topic
// comments (and topics left empty), neighbourhood posts + comments, resolved
// reports, the automod log and old moderator actions.
//
// Efficiency: RTDB candidate scans use shallow REST queries and chat deletes
// are one multi-path update per batch; Firestore deletes use batched deletes
// and recursiveDelete. The job stops at an 8-minute internal budget before the
// 540 s timeout, so a backlog is caught up oldest-first over multiple days.
//
// First rollout: set SOCIAL_CLEANUP_DRY_RUN=1 in firebase-functions/.env,
// deploy, run the Cloud Scheduler job manually, inspect the logs, then remove
// the flag and redeploy. See docs/agent/social-cleanup.md.
// ---------------------------------------------------------------------------
const { runSocialCleanup } = require("./social-cleanup");

exports.cleanupSocial = onSchedule(
    {
        schedule: "0 4 * * *",
        timeZone: "Australia/Sydney",
        region: "us-central1",
        memory: "256MiB",
        timeoutSeconds: 540,
        maxInstances: 1,
        retryCount: 0
    },
    async () => {
        if (!socialAdminApp) {
            throw new Error('cleanupSocial: SOCIAL_SERVICE_ACCOUNT_JSON is not configured');
        }

        const socialCredential = socialAdminApp.options.credential;
        if (!socialCredential || typeof socialCredential.getAccessToken !== 'function') {
            throw new Error('cleanupSocial: social service-account credential is unavailable');
        }

        const primaryApp = admin.app();
        const primaryCredential = primaryApp.options.credential || admin.credential.applicationDefault();

        const summary = await runSocialCleanup({
            socialApp: socialAdminApp,
            primaryApp,
            logger,
            accessTokens: {
                social: async () => (await socialCredential.getAccessToken()).access_token,
                primary: async () => (await primaryCredential.getAccessToken()).access_token
            }
        });

        // Surface partial failures in Cloud Monitoring instead of silently
        // succeeding. Tasks are independent, so every other task has run.
        if (summary.errors.length > 0) {
            throw new Error(`cleanupSocial finished with ${summary.errors.length} task error(s)`);
        }
    }
);
