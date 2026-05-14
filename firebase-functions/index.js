/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions/v1");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");
const simpleParser = require("mailparser").simpleParser;
const nodemailer = require("nodemailer");

admin.initializeApp();

// Allowed origins (same as Cloudflare workers)
const allowedOrigins = [
    "https://beta.rekindle.pages.dev",
    "https://rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
];

// Common options for all functions
const callOptions = {
    cors: allowedOrigins,  // Restrict to allowed origins only
    maxInstances: 10       // Limit concurrency for IMAP connections to avoid hitting limits
};

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
    const forwarded = request.rawRequest.headers['x-forwarded-for'];
    const rawIp = (forwarded ? forwarded.split(',')[0].trim() : request.rawRequest.ip) || '';
    // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
    const ip = rawIp.replace(/^::ffff:/, '');

    // Check banned IPs — this happens on the server, nothing the client can bypass
    if (ip) {
        const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
        const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
        if (snap.exists()) {
            logger.warn(`Blocked registration from banned IP: ${ip} (username attempt: ${username})`);
            throw new HttpsError('permission-denied', 'Registration is not available from your network.');
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
            throw new HttpsError('permission-denied', 'Registration is not available from your network.');
        }
    }

    // Return a custom token so the client can call signInWithCustomToken()
    const customToken = await admin.auth().createCustomToken(userRecord.uid);
    return { customToken };
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
            return { banned: true };
        }
        // Keep stored IP current so ban-by-IP lookups stay accurate
        await admin.database().ref(`users_private/${uid}/ipAddress`).set(ip);
    }

    return { banned: false };
});

