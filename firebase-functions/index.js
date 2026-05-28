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
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");
const simpleParser = require("mailparser").simpleParser;
const nodemailer = require("nodemailer");
// jose removed — no longer needed after AgeVerif integration removal

admin.initializeApp();

// Initialize secondary admin app for social project (rekindle-socials)
let socialAdminApp = null;
try {
    const socialServiceAccount = JSON.parse(process.env.SOCIAL_SERVICE_ACCOUNT_JSON || '{}');
    if (socialServiceAccount.project_id) {
        socialAdminApp = admin.initializeApp({
            credential: admin.credential.cert(socialServiceAccount),
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
    maxInstances: 10       // Limit concurrency for IMAP connections to avoid hitting limits
};

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

    // Set custom claim on social project
    if (socialAdminApp) {
        try {
            await socialAdminApp.auth().setCustomUserClaims(uid, {
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
    const { imap: imapConfig, path = 'INBOX', cursor, limit = 20 } = request.data;

    if (!imapConfig) {
        throw new HttpsError('invalid-argument', 'Missing IMAP configuration');
    }

    const client = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port || 993,
        secure: imapConfig.secure !== false,
        auth: imapConfig.auth,
        logger: false
    });

    try {
        await client.connect();

        let lock = await client.getMailboxLock(path);
        try {
            const status = await client.status(path, { messages: true });
            const total = status.messages;

            if (total === 0) {
                return { success: true, messages: [], nextCursor: null };
            }

            // Calculate range
            // If cursor is provided, we fetch ending at cursor - 1
            // If not provided, we fetch ending at total
            let endObj = cursor ? Math.max(1, cursor - 1) : total;
            let startObj = Math.max(1, endObj - limit + 1);

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
        throw new HttpsError('internal', "IMAP Error: " + err.message, err);
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});


exports.moveEmail = onCall(callOptions, async (request) => {
    const { imap: imapConfig, path, uid, destination } = request.data;
    // ... validation ...
    const client = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port || 993,
        secure: imapConfig.secure !== false,
        auth: imapConfig.auth,
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock(path);
        try {
            await client.messageMove(String(uid), destination, { uid: true });
            return { success: true };
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("Move Error", err);
        throw new HttpsError('internal', "Move Error: " + err.message, err);
    } finally {
        if (client) await client.logout().catch(() => { });
    }
});

exports.modifyFlags = onCall(callOptions, async (request) => {
    const { imap: imapConfig, path, uid, addFlags, removeFlags } = request.data;
    const client = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port || 993,
        secure: imapConfig.secure !== false,
        auth: imapConfig.auth,
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock(path);
        try {
            if (addFlags && addFlags.length) {
                await client.messageFlagsAdd(String(uid), addFlags, { uid: true });
            }
            if (removeFlags && removeFlags.length) {
                await client.messageFlagsRemove(String(uid), removeFlags, { uid: true });
            }
            return { success: true };
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("Flag Error", err);
        throw new HttpsError('internal', "Flag Error: " + err.message, err);
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
    const { imap: imapConfig, path = 'INBOX', uid } = request.data;

    if (!imapConfig || !uid) {
        throw new HttpsError('invalid-argument', 'Missing IMAP config or UID');
    }

    const client = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port || 993,
        secure: imapConfig.secure !== false,
        auth: imapConfig.auth,
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock(path);
        try {
            // client.fetch returns a generator, iterate to get the message
            // Convert UID to string to ensure it's treated as a UID range if numeric
            const uidStr = String(uid);
            let message;

            console.log("Fetching UID:", uidStr, "in", path); // DEBUG

            try {
                message = await client.fetchOne(uidStr, { source: true, uid: true });
            } catch (e) {
                console.log("fetchOne error:", e);
            }

            if (!message) {
                // Try searching for the sequence number first as a fallback
                console.log("Direct UID fetch failed. Searching for sequence number for UID:", uidStr);
                const seq = await client.search({ uid: uidStr });
                if (seq && seq.length > 0) {
                    console.log("Found sequence number:", seq[0]);
                    message = await client.fetchOne(seq[0], { source: true });
                }
            }

            if (!message) {
                // List all UIDs for debugging
                const allUids = [];
                for await (let m of client.fetch('1:*', { uid: true })) {
                    allUids.push(m.uid);
                }
                console.log("Available UIDs in folder:", allUids.slice(-10)); // Log last 10 UIDs

                throw new HttpsError('not-found', "Message not found for UID: " + uidStr + " in folder: " + path);
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
                    attachments: [] // Attachments can be large, handle separately if needed
                }
            };

        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("IMAP Body Error", err);
        throw new HttpsError('internal', "IMAP Body Error: " + err.message, err);
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
exports.sendEmail = onCall(callOptions, async (request) => {
    const { smtp: smtpConfig, message } = request.data;

    if (!smtpConfig || !message) {
        throw new HttpsError('invalid-argument', 'Missing SMTP config or message');
    }

    const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port || 465,
        secure: smtpConfig.secure !== false,
        auth: smtpConfig.auth
    });

    try {
        const info = await transporter.sendMail({
            from: message.from || smtpConfig.auth.user,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html
        });

        return { success: true, messageId: info.messageId };
    } catch (err) {
        logger.error("SMTP Error", err);
        throw new HttpsError('internal', "SMTP Error: " + err.message, err);
    }
});

/*
 * IMAP List Folders
 * Expects data: {
 *   imap: { ... }
 * }
 */
exports.getFolders = onCall(callOptions, async (request) => {
    const { imap: imapConfig } = request.data;

    if (!imapConfig) {
        throw new HttpsError('invalid-argument', 'Missing IMAP configuration');
    }

    const client = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port || 993,
        secure: imapConfig.secure !== false,
        auth: imapConfig.auth,
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
        logger.error("IMAP Folder Error", err);
        throw new HttpsError('internal', "IMAP Folder Error: " + err.message, err);
    } finally {
        if (client) await client.logout().catch(() => { });
    }
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
    let isMod = false;
    if (!isAdmin) {
        const modSnap = await admin.database().ref('moderators/' + callerUid).once('value');
        isMod = modSnap.exists();
    }
    if (!isAdmin && !isMod) {
        throw new HttpsError('permission-denied', 'Admin or moderator access required.');
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
    let isMod = false;
    if (!isAdmin) {
        const modSnap = await admin.database().ref('moderators/' + callerUid).once('value');
        isMod = modSnap.exists();
    }
    if (!isAdmin && !isMod) {
        throw new HttpsError('permission-denied', 'Admin or moderator access required.');
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

    // Fetch moderator status from main project RTDB
    const modSnap = await admin.database().ref('moderators/' + uid).once('value');
    const isModerator = modSnap.val() === true;

    // Pro status from auth token claims or admin email
    const isPro = request.auth.token.pro === true || request.auth.token.email === 'ukiyo@rekindle.ink';

    // Age verification status from main project auth claims
    const isAgeVerified = request.auth.token.ageVerified === true;

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
    // their email so they show up in the Firebase Console Authentication section.
    if (email) {
        try {
            const socialUser = await socialAdminApp.auth().getUser(uid);
            if (socialUser.email !== email) {
                await socialAdminApp.auth().updateUser(uid, { email });
            }
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                await socialAdminApp.auth().createUser({
                    uid,
                    email,
                    emailVerified: true
                });
            } else {
                logger.warn('getSocialToken: failed to sync user to social project:', e.message);
            }
        }
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

