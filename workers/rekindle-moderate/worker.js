/**
 * REKINDLE MODERATE — Cloudflare Worker
 *
 * Server-side content moderation + posting for:
 * - kindlechat messages (RTDB)
 * - topics (Firestore)
 * - topic comments (Firestore)
 * - neighbourhood posts (Firestore)
 * - neighbourhood comments (Firestore)
 * - suggestions (Primary RTDB)
 * - suggestion comments (Primary RTDB)
 *
 * Authenticates users via Firebase ID token, calls OpenAI Moderation,
 * then writes to Firebase using a service account (bypasses security rules).
 */

const ALLOWED_ORIGINS = [
    "https://beta.rekindle.ink",
    "https://rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink"
];

// Cache Google access token in isolate memory
let cachedAccessToken = null;
let cachedTokenExpiry = 0;

/* ------------------------------------------------------------------ */
/*  CORS                                                               */
/* ------------------------------------------------------------------ */
function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.includes(origin);
    return {
        "Access-Control-Allow-Origin": allowed ? origin : "null",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        // Cache the preflight for a day. Without this every JSON POST from the
        // chat costs TWO Worker requests (OPTIONS + POST), which is what pushed
        // the account over the 100k/day Workers Free limit on 2026-10-25 and
        // took KindleChat down with a CORS-less Cloudflare 429 (error 1027).
        // Chromium caps this at 2h, Safari at 10min; either is a huge cut.
        "Access-Control-Max-Age": "86400",
        // The allowed origin is reflected, so caches/intermediaries must key
        // on it. Cheap insurance; this worker never caches POSTs itself.
        "Vary": "Origin",
        "Content-Type": "application/json"
    };
}

/* ------------------------------------------------------------------ */
/*  SECRET RESOLUTION                                                  */
/* ------------------------------------------------------------------ */
function resolveServiceAccount(env) {
    // Support full JSON blob OR separate secrets
    if (env.SOCIAL_SERVICE_ACCOUNT_JSON) {
        try {
            const sa = JSON.parse(env.SOCIAL_SERVICE_ACCOUNT_JSON);
            if (!sa.client_email || !sa.private_key) {
                throw new Error("SOCIAL_SERVICE_ACCOUNT_JSON missing client_email or private_key");
            }
            return {
                clientEmail: sa.client_email,
                privateKey: sa.private_key,
                projectId: sa.project_id || null
            };
        } catch (e) {
            throw new Error("Failed to parse SOCIAL_SERVICE_ACCOUNT_JSON: " + e.message);
        }
    }
    if (env.SOCIAL_CLIENT_EMAIL && env.SOCIAL_PRIVATE_KEY) {
        return {
            clientEmail: env.SOCIAL_CLIENT_EMAIL,
            privateKey: env.SOCIAL_PRIVATE_KEY,
            projectId: null
        };
    }
    throw new Error("Missing service account credentials. Set either SOCIAL_SERVICE_ACCOUNT_JSON or both SOCIAL_CLIENT_EMAIL + SOCIAL_PRIVATE_KEY.");
}

/* ------------------------------------------------------------------ */
/*  FIRESTORE REST HELPERS                                             */
/* ------------------------------------------------------------------ */
function toFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number") {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
    if (typeof value === "object") {
        const fields = {};
        for (const [k, v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
        return { mapValue: { fields } };
    }
    return { stringValue: String(value) };
}

async function firestoreCreate(collectionPath, data, accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/${collectionPath}`;
    const fields = {};
    for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreValue(value);
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({ fields })
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Firestore create failed (${resp.status}): ${errText}`);
    }
    const json = await resp.json();
    const parts = (json.name || "").split("/");
    return parts[parts.length - 1];
}

async function firestorePatch(docPath, data, accessToken) {
    const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/${docPath}?${mask}`;
    const fields = {};
    for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreValue(value);
    const resp = await fetch(url, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({ fields })
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Firestore patch failed (${resp.status}): ${errText}`);
    }
}

async function firestoreCommitTransform(docPath, fieldTransforms, accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents:commit`;
    const body = {
        writes: [
            {
                transform: {
                    document: `projects/rekindle-socials/databases/(default)/documents/${docPath}`,
                    fieldTransforms
                },
                // A transform on a missing document would create a stub with only
                // the transformed field (e.g. a `{commentCount: 1}` "post" for a
                // comment posted against a deleted post id). Require the parent
                // to exist; callers catch the resulting failure.
                currentDocument: { exists: true }
            }
        ]
    };
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify(body)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Firestore commit failed (${resp.status}): ${errText}`);
    }
}

/* ------------------------------------------------------------------ */
/*  FIRESTORE DELETE HELPER                                            */
/* ------------------------------------------------------------------ */
async function firestoreDelete(docPath, accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/${docPath}`;
    const resp = await fetch(url, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${accessToken}` }
    });
    if (!resp.ok && resp.status !== 404) {
        const errText = await resp.text();
        throw new Error(`Firestore delete failed (${resp.status}): ${errText}`);
    }
}

/* ------------------------------------------------------------------ */
/*  RTDB REST HELPERS                                                  */
/* ------------------------------------------------------------------ */
async function rtdbPush(path, data, userToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?auth=${encodeURIComponent(userToken)}`;
    console.log("[WORKER] rtdbPush URL:", url.replace(/auth=([^&]+)/, "auth=<REDACTED>"));
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        console.error("[WORKER] rtdbPush failed:", resp.status, errText);
        throw new Error(`RTDB push failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function rtdbPushWithAccessToken(path, data, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    console.log("[WORKER] rtdbPushWithAccessToken URL:", url.replace(/access_token=([^&]+)/, "access_token=<REDACTED>"));
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        console.error("[WORKER] rtdbPushWithAccessToken failed:", resp.status, errText);
        throw new Error(`RTDB push failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function rtdbSetWithAccessToken(path, data, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    console.log("[WORKER] rtdbSetWithAccessToken URL:", url.replace(/access_token=([^&]+)/, "access_token=<REDACTED>"));
    const resp = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        console.error("[WORKER] rtdbSetWithAccessToken failed:", resp.status, errText);
        throw new Error(`RTDB set failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function rtdbPushWithAccessTokenAndReturnKey(path, data, accessToken) {
    const result = await rtdbPushWithAccessToken(path, data, accessToken);
    return result.name;
}

async function rtdbPatchWithAccessToken(path, data, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB patch failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function rtdbGetWithUserToken(path, env, userToken) {
    const projectId = env.FIREBASE_PROJECT_ID || "rekindle-dd1fa";
    const url = `https://${projectId}-default-rtdb.firebaseio.com/${path}.json?auth=${encodeURIComponent(userToken)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB get with user token failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function rtdbGetWithAccessToken(path, env, accessToken) {
    const projectId = env.FIREBASE_PROJECT_ID || "rekindle-dd1fa";
    const url = `https://${projectId}-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB get with access token failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function rtdbDeleteWithAccessToken(path, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, { method: "DELETE" });
    if (!resp.ok && resp.status !== 404) {
        const errText = await resp.text();
        throw new Error(`RTDB delete failed (${resp.status}): ${errText}`);
    }
}

async function rtdbDeletePrimaryWithAccessToken(path, accessToken) {
    const url = `https://rekindle-dd1fa-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, { method: "DELETE" });
    if (!resp.ok && resp.status !== 404) {
        const errText = await resp.text();
        throw new Error(`Primary RTDB delete failed (${resp.status}): ${errText}`);
    }
}

/* ------------------------------------------------------------------ */
/*  REPORTS STORAGE (RTDB)                                             */
/* ------------------------------------------------------------------ */
const REPORTS_PATH = "reports";

async function getExistingPendingReport(contentType, contentId, accessToken) {
    try {
        const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${REPORTS_PATH}.json?orderBy="contentId"&equalTo="${encodeURIComponent(contentId)}"&access_token=${encodeURIComponent(accessToken)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            console.error("[REPORT] Failed to query existing reports:", resp.status);
            return null;
        }
        const data = await resp.json();
        if (!data || typeof data !== "object") return null;

        const matching = Object.entries(data)
            .map(([key, value]) => ({
                reportId: key,
                reporterId: value.reporterId || "",
                reporterName: value.reporterName || "",
                itemContentType: value.contentType || "",
                contentPath: value.contentPath || "",
                status: value.status || "",
                createdAt: value.createdAt || 0
            }))
            .filter(r => r.itemContentType === contentType && r.status === "pending")
            .sort((a, b) => b.createdAt - a.createdAt);

        return matching.length > 0 ? matching[0] : null;
    } catch (e) {
        console.error("[REPORT] Error querying existing reports:", e.message);
        return null;
    }
}

async function rtdbUpdateReport(reportId, updates, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${REPORTS_PATH}/${reportId}.json?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB report update failed (${resp.status}): ${errText}`);
    }
}

/* ------------------------------------------------------------------ */
/*  CONTENT DELETION                                                   */
/* ------------------------------------------------------------------ */

// Comment documents live one level below their parent, so a bare comment id
// cannot identify the parent on its own. Only accept the exact shape the
// reporting client writes: {root}/{parentId}/comments/{commentId}.
function parseCommentPath(contentPath, root) {
    if (!contentPath) return null;
    const parts = String(contentPath).split("/");
    if (parts.length === 4 && parts[0] === root && parts[2] === "comments") {
        return { parentId: parts[1], commentId: parts[3] };
    }
    return null;
}

// Adjust a parent document's denormalised commentCount after a comment is
// removed. Reads first so a legacy document with no counter (or a double
// delete) cannot drive the value negative.
async function adjustParentCommentCount(parentPath, delta, accessToken) {
    if (!parentPath || !delta) return;
    try {
        const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/${parentPath}`;
        const resp = await fetch(url, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (!resp.ok) return; // Parent already gone (404) - nothing to fix.
        const doc = await resp.json();
        const raw = doc.fields && doc.fields.commentCount;
        let current = 0;
        if (raw) {
            if (raw.integerValue !== undefined) current = parseInt(raw.integerValue, 10) || 0;
            else if (raw.doubleValue !== undefined) current = Math.round(raw.doubleValue) || 0;
        }
        const next = Math.max(0, current + delta);
        await firestorePatch(parentPath, { commentCount: next }, accessToken);
    } catch (e) {
        console.error(`[COMMENT-COUNT] Failed to adjust ${parentPath}:`, e.message);
    }
}

async function autoDeleteContent(contentType, contentId, contentPath, accessToken) {
    try {
        if (contentType === "kindlechat") {
            await rtdbDeleteWithAccessToken(`kindlechat/messages/${contentId}`, accessToken);
            // Also remove from the art index if this message was pixel art or a flipbook.
            await rtdbDeleteWithAccessToken(`kindlechat/art_index/${contentId}`, accessToken).catch(e => console.error("[AUTO-DELETE] art_index delete failed:", e.message));
            console.log(`[AUTO-DELETE] Deleted kindlechat message ${contentId}`);
            return true;
        }
        if (contentType === "topic") {
            // Delete topic and all comments
            await firestoreDelete(`topics/${contentId}`, accessToken);
            console.log(`[AUTO-DELETE] Deleted topic ${contentId}`);
            return true;
        }
        if (contentType === "topic_comment") {
            // contentPath is like "topics/{topicId}/comments/{commentId}"
            const parsed = parseCommentPath(contentPath, "topics");
            if (!parsed || parsed.commentId !== contentId) {
                console.error("[AUTO-DELETE] Refusing invalid topic comment path:", contentPath);
                return false;
            }
            await firestoreDelete(contentPath, accessToken);
            await adjustParentCommentCount(`topics/${parsed.parentId}`, -1, accessToken);
            console.log(`[AUTO-DELETE] Deleted topic comment ${contentId}`);
            return true;
        }
        if (contentType === "neighbourhood_post") {
            await firestoreDelete(`neighbourhood_posts/${contentId}`, accessToken);
            console.log(`[AUTO-DELETE] Deleted neighbourhood post ${contentId}`);
            return true;
        }
        if (contentType === "neighbourhood_comment") {
            // contentPath is like "neighbourhood_posts/{postId}/comments/{commentId}"
            const parsed = parseCommentPath(contentPath, "neighbourhood_posts");
            if (!parsed || parsed.commentId !== contentId) {
                console.error("[AUTO-DELETE] Refusing invalid neighbourhood comment path:", contentPath);
                return false;
            }
            await firestoreDelete(contentPath, accessToken);
            await adjustParentCommentCount(`neighbourhood_posts/${parsed.parentId}`, -1, accessToken);
            console.log(`[AUTO-DELETE] Deleted neighbourhood comment ${contentId}`);
            return true;
        }
        if (contentType === "suggestion") {
            // Suggestions live in the primary RTDB project
            await rtdbDeletePrimaryWithAccessToken(`suggestions/${contentId}`, accessToken);
            console.log(`[AUTO-DELETE] Deleted suggestion ${contentId}`);
            return true;
        }
        if (contentType === "suggestion_comment") {
            // contentPath is like "suggestions/{suggestionId}/comments/{commentKey}"
            const parsed = parseCommentPath(contentPath, "suggestions");
            if (!parsed || parsed.commentId !== contentId) {
                console.error("[AUTO-DELETE] Refusing invalid suggestion comment path:", contentPath);
                return false;
            }
            await rtdbDeletePrimaryWithAccessToken(contentPath, accessToken);
            console.log(`[AUTO-DELETE] Deleted suggestion comment ${contentId}`);
            return true;
        }
        if (contentType === "dm_message") {
            // DM messages live in the SOCIAL RTDB. Only delete a path that
            // matches the strict DM shape; never trust an arbitrary path from
            // a report payload.
            const parsed = parseDmMessagePath(contentPath);
            if (!parsed || parsed.messageId !== contentId) {
                console.error("[AUTO-DELETE] Refusing invalid DM message path:", contentPath);
                return false;
            }
            await rtdbDeleteWithAccessToken(`kindlechat/dm_messages/${parsed.threadId}/${parsed.messageId}`, accessToken);
            console.log(`[AUTO-DELETE] Deleted DM message ${parsed.messageId} in ${parsed.threadId}`);
            return true;
        }
        return false;
    } catch (e) {
        console.error(`[AUTO-DELETE] Failed to delete ${contentType}/${contentId}:`, e.message);
        return false;
    }
}

function containsUrl(text) {
    if (!text) return false;
    const t = String(text).toLowerCase();
    const protocolLike = /h\s*t\s*t\s*p\s*s?\s*[:/]{1,4}/.test(t);
    const wwwLike = /\bwww\./.test(t);
    const domainLike = /\b[a-z0-9-]+\s*\.\s*(com|net|org|io|co|ai|app|dev|edu|gov|mil|int|biz|info|name|pro|museum|aero|coop|jobs|mobi|travel|arpa|asia|cat|tel|xxx|post|geo|mail|onion|bit|crypto|eth|us|uk|au|ca|de|fr|jp|cn|kr|ru|br|mx|es|it|nl|se|no|fi|dk|pl|cz|at|ch|be|pt|ie|nz|za|in|sg|hk|tw|id|th|vn|ph|my|xyz|club|online|site|top|ink|cc|tv|ws|me|nu|gg|to|vc|link)\b/.test(t);
    const ipLike = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t);
    return protocolLike || wwwLike || domainLike || ipLike;
}

// Banned competitor mentions (KindleHub / kindlehub.pro / Unreader / InkChat).
// KEEP IN SYNC with js/promo-ban.js - the client uses the same folding rules so
// the UI and the server agree on what counts as a mention.
//
// The KindleHub owner evades naive regexes with spelled-out dots
// ("kindlehubDOTpro"), Cyrillic/Greek homoglyphs ("kindlеhub"), leetspeak
// ("Unr3ad3r"), separators ("kindle.hub") and the "khub" abbreviation, so the
// text is folded to ASCII (homoglyphs -> letters, leet -> letters, diacritics
// stripped) and compacted (non-alphanumerics dropped) before matching.
const PROMO_HOMOGLYPHS = {
    // Cyrillic
    "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u0451": "e", "\u043A": "k",
    "\u043C": "m", "\u043D": "h", "\u043E": "o", "\u0440": "p", "\u0441": "c",
    "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0457": "i",
    "\u0455": "s", "\u0501": "d", "\u04CF": "l", "\u0458": "j", "\u051B": "q",
    "\u051D": "w", "\u0261": "g", "\u044C": "b", "\u043F": "n",
    // Greek
    "\u03B1": "a", "\u03B2": "b", "\u03B5": "e", "\u03B9": "i", "\u03BA": "k",
    "\u03BD": "v", "\u03BF": "o", "\u03C1": "p", "\u03C3": "o", "\u03C4": "t",
    "\u03C5": "u", "\u03C7": "x", "\u03C9": "w", "\u03B3": "y", "\u03B7": "n",
    "\u03BC": "u", "\u03C0": "n", "\u03B6": "z",
    // Latin small caps / dotless forms
    "\u0131": "i", "\u0251": "a", "\u2113": "l", "\u026A": "i", "\u0280": "r",
    "\u0274": "n", "\u028F": "y", "\u0262": "g", "\u029C": "h", "\u0299": "b",
    "\u1D0B": "k", "\u1D1C": "u", "\u1D0F": "o", "\u1D00": "a", "\u1D04": "c",
    "\u1D05": "d", "\u1D07": "e", "\u1D0A": "j", "\u029F": "l", "\u1D0D": "m",
    "\u1D18": "p", "\uA731": "s", "\uA730": "f", "\u1D1B": "t"
};
const PROMO_LEET = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
    "9": "g", "@": "a", "$": "s", "!": "i", "|": "i"
};
const PROMO_TERMS = ["kindlehub", "unreader", "inkchat"];

function promoFoldChar(ch) {
    if (!ch) return "";
    const code = ch.charCodeAt(0);
    let c = ch;
    if (code > 127 && typeof ch.normalize === "function") {
        try {
            const n = ch.normalize("NFKD");
            if (n) c = n.charAt(0);
        } catch (e) {
            c = ch;
        }
    }
    c = c.toLowerCase();
    if (c.length !== 1) c = ch.charAt(0).toLowerCase();
    return PROMO_HOMOGLYPHS[c] || PROMO_LEET[c] || c;
}

function promoFoldText(text) {
    const s = String(text || "");
    let folded = "";
    let compact = "";
    const map = [];
    for (let i = 0; i < s.length; i++) {
        const f = promoFoldChar(s.charAt(i));
        folded += f;
        if (f.length === 1 && /[a-z0-9]/.test(f)) {
            compact += f;
            map.push(i);
        }
    }
    return { folded: folded, compact: compact, map: map };
}

function containsPromotedTerm(text) {
    if (!text) return false;
    const s = String(text);
    const info = promoFoldText(s);

    // Compact terms catch separators / homoglyphs / "DOT" spellings.
    for (let t = 0; t < PROMO_TERMS.length; t++) {
        const term = PROMO_TERMS[t];
        let from = 0;
        let at = info.compact.indexOf(term, from);
        while (at !== -1) {
            from = at + 1;
            const start = info.map[at];
            // "unreader"/"inkchat" need a word boundary or ordinary phrases
            // ("run reader" -> "runreader") would match. "kindlehub" is
            // distinctive enough to match inside a word.
            const before = start > 0 ? promoFoldChar(s.charAt(start - 1)) : "";
            if (term === "kindlehub" || !/[a-z0-9]/.test(before)) return true;
            at = info.compact.indexOf(term, from);
        }
    }

    // Standalone "khub" / "K-Hub" abbreviation.
    const khubRe = /(^|[^a-z0-9])k[\W_]*hub(?![a-z0-9])/g;
    return khubRe.test(info.folded);
}

function containsDih(text) {
    if (!text) return false;
    // Match "dih" as a standalone word or any word ending in "dih",
    // without blocking words that merely start with "dih" (e.g. dihalide).
    return /\bdih\b|\b\w+dih\b/i.test(String(text));
}

// Every content write used to pay an RTDB GET for timeouts/{uid}, which is
// empty for virtually every user. Cache the verdict briefly; a timeout still
// takes effect within 30s, and repeat attempts from a timed-out user stop
// costing a Firebase round trip each.
const timeoutCache = new Map(); // uid -> { expires: number, result: object }
const TIMEOUT_CACHE_TTL_MS = 30 * 1000;

function cacheTimeoutResult(uid, result) {
    timeoutCache.set(uid, { expires: Date.now() + TIMEOUT_CACHE_TTL_MS, result });
    if (timeoutCache.size > 500) {
        const now = Date.now();
        for (const [key, entry] of timeoutCache) {
            if (entry.expires <= now) timeoutCache.delete(key);
        }
    }
    return result;
}

async function checkTimeout(uid, env, userToken, accessToken) {
    const cached = timeoutCache.get(uid);
    if (cached && cached.expires > Date.now()) return cached.result;

    let result = { timedOut: false };
    try {
        const data = await rtdbGetWithUserToken(`timeouts/${uid}`, env, userToken);
        if (data && typeof data.until === "number") {
            const now = Date.now();
            if (data.until > now) {
                const remainingMinutes = Math.ceil((data.until - now) / 60000);
                result = { timedOut: true, remainingMinutes };
            }
        }
    } catch (e) {
        console.error("[Moderate] Timeout check with user token failed:", e.message);
        // Fallback to service account (bypasses rules, needs IAM permissions)
        try {
            const data = await rtdbGetWithAccessToken(`timeouts/${uid}`, env, accessToken);
            if (data && typeof data.until === "number") {
                const now = Date.now();
                if (data.until > now) {
                    const remainingMinutes = Math.ceil((data.until - now) / 60000);
                    result = { timedOut: true, remainingMinutes };
                }
            }
        } catch (e2) {
            console.error("[Moderate] Timeout check with access token failed:", e2.message);
        }
    }
    return cacheTimeoutResult(uid, result);
}

/* ------------------------------------------------------------------ */
/*  FIREBASE TOKEN VERIFICATION                                        */
/* ------------------------------------------------------------------ */
const GOOGLE_JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const GOOGLE_JWK_TTL_MS = 6 * 60 * 60 * 1000; // Google's Cache-Control max-age is ~6h

async function fetchGoogleJwks() {
    const cacheKey = new Request(GOOGLE_JWK_URL);
    let cache = null;
    try {
        cache = caches.default;
        const cached = await cache.match(cacheKey);
        if (cached) {
            const ts = Number(cached.headers.get("x-cache-ts") || 0);
            if (ts > 0 && Date.now() - ts < GOOGLE_JWK_TTL_MS) {
                try {
                    return await cached.json();
                } catch (e) {
                    // Corrupt cached entry — fall through to network
                }
            }
        }
    } catch (e) {
        cache = null; // Cache API unavailable — fall through to network
    }

    const keysRes = await fetch(GOOGLE_JWK_URL);
    if (!keysRes.ok) throw new Error("Could not fetch Google public keys: " + keysRes.status);

    if (cache) {
        try {
            const headers = new Headers(keysRes.headers);
            headers.set("x-cache-ts", String(Date.now()));
            headers.set("Cache-Control", "public, max-age=21600");
            await cache.put(cacheKey, new Response(keysRes.clone().body, { status: keysRes.status, headers }));
        } catch (e) {
            // Cache write failures are non-fatal
        }
    }
    return keysRes.json();
}

async function verifyFirebaseToken(token, env) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed token: expected 3 parts");

    const b64decode = (base64) => {
        const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
        return JSON.parse(atob(padded));
    };

    let header, payload;
    try {
        header = b64decode(parts[0]);
        payload = b64decode(parts[1]);
    } catch (e) {
        throw new Error("Failed to decode token payload: " + e.message);
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error("Token expired");

    // Accept tokens from either the main Firebase project or the social project
    const sa = resolveServiceAccount(env);
    const allowedAuds = [env.FIREBASE_PROJECT_ID, sa.projectId].filter(Boolean);
    if (allowedAuds.length === 0) {
        throw new Error("No Firebase project IDs configured. Set FIREBASE_PROJECT_ID or SOCIAL_SERVICE_ACCOUNT_JSON with a project_id.");
    }
    if (!allowedAuds.includes(payload.aud)) {
        throw new Error(`Invalid audience: token aud="${payload.aud}" not in allowed=[${allowedAuds.join(", ")}]`);
    }
    const validIss = allowedAuds.map(id => `https://securetoken.google.com/${id}`);
    if (!validIss.includes(payload.iss)) {
        throw new Error(`Invalid issuer: token iss="${payload.iss}" not in allowed=[${validIss.join(", ")}]`);
    }

    const keys = await fetchGoogleJwks();

    const jwk = keys.keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error("Unknown signing key: kid=" + header.kid);

    const cryptoKey = await crypto.subtle.importKey(
        "jwk", jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false, ["verify"]
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sig, data);
    if (!valid) throw new Error("Invalid token signature");

    return payload;
}

/* ------------------------------------------------------------------ */
/*  GOOGLE SERVICE ACCOUNT AUTH                                        */
/* ------------------------------------------------------------------ */
async function getCachedAccessToken(env) {
    const now = Date.now();
    if (cachedAccessToken && cachedTokenExpiry > now + 60000) {
        return cachedAccessToken;
    }
    const token = await getGoogleAccessToken(env);
    cachedAccessToken = token;
    cachedTokenExpiry = now + 3600000;
    return token;
}

async function getGoogleAccessToken(env) {
    const sa = resolveServiceAccount(env);
    const clientEmail = sa.clientEmail;
    const privateKeyPEM = sa.privateKey;

    // Unescape literal newlines that may have come from CLI input
    let normalizedPem = privateKeyPEM.replace(/\\n/g, "\n");

    // Regex pull body
    const match = normalizedPem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
    let privateKeyBody = match ? match[1] : normalizedPem
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "");
    privateKeyBody = privateKeyBody.replace(/\s+/g, "");

    if (!privateKeyBody) throw new Error("Could not extract private key body from PEM");

    let binaryKey;
    try {
        binaryKey = str2ab(atob(privateKeyBody));
    } catch (e) {
        throw new Error("Failed to base64-decode private key: " + e.message);
    }

    let key;
    try {
        key = await crypto.subtle.importKey(
            "pkcs8",
            binaryKey,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["sign"]
        );
    } catch (e) {
        throw new Error(`ImportKey failed. Key size: ${binaryKey.byteLength} bytes. Error: ${e.message}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const encodedHeader = b64url(JSON.stringify(header));
    const encodedClaim = b64url(JSON.stringify(claim));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;

    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(unsignedToken)
    );

    const signedToken = `${unsignedToken}.${b64urlEncode(signature)}`;

    const params = new URLSearchParams();
    params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    params.append("assertion", signedToken);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
        throw new Error("Google OAuth2 Error: " + JSON.stringify(tokenData));
    }
    return tokenData.access_token;
}

function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i);
    return buf;
}

function b64url(str) {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncode(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ------------------------------------------------------------------ */
/*  ASCII EMOJI STRIPPING                                              */
/* ------------------------------------------------------------------ */
// These are the ASCII art emojis from @emojis.js. They must be stripped
// before OpenAI moderation because the model incorrectly flags innocent
// emoticons (e.g. Lenny face, shrug) as sexual or harassing.
const ASCII_EMOJI_ARTS = [
    "\\˚ㄥ˚\\", "☁ ▅▒░☼‿☼░▒▅ ☁", "ˁ˚ᴥ˚ˀ", "⎦˚◡˚⎣", "<*_*>",
    "(-(-_(-_-)_-)-)", "(✿ ♥‿♥)", "㋡", "(⌒▽⌒)", "(◔/‿\\◔)",
    "(⋗_⋖)", "ة_ة", "\\(^-^)/", "◕_◕", "(っ◕‿◕)っ", "( ͠° ͟ʖ ͡°)",
    "ʘ‿ʘ", "(｡◕‿◕｡)", "☜(⌒▽⌒)☞", "ヽ(´▽`)/", "ヽ(´ー｀)ノ",
    "⊂(◉‿◉)つ", "(づ￣ ³￣)づ", "“ヽ(´▽｀)ノ”", "♥‿♥", "( ˘ ³˘)♥",
    "\\(ᵔᵕᵔ)/", "ᴖ̮ ̮ᴖ", "-`ღ´-", "ಠ_ಠ", "(╬ ಠ益ಠ)", "ლ(ಠ益ಠლ)",
    "ಠ‿ಠ", "ಥ_ಥ", "ಥ﹏ಥ", "٩◔̯◔۶", "(´･_･`)", "(ಥ⌣ಥ)", "눈_눈",
    "( ఠ ͟ʖ ఠ)", "( ͡ಠ ʖ̯ ͡ಠ)", "( ಠ ʖ̯ ಠ)", "(ᵟຶ︵ ᵟຶ)", "¯\\_(ツ)_/¯",
    "( ͡° ͜ʖ ͡°)", "ᕙ(⇀‸↼‶)ᕗ", "┌(ㆆ㉨ㆆ)ʃ", "(•̀ᴗ•́)و ̑̑",
    "(☞ﾟヮﾟ)☞", "(っ▀¯▀)つ", "(∩｀-´)⊃━☆ﾟ.*･｡ﾟ", "(╯°□°）╯︵ ┻━┻",
    "┬─┬ ノ( ゜-゜ノ)", "┬─┬⃰͡ (ᵔᵕᵔ͜ )", "(ง'̀-'́)ง", "ʕ•ᴥ•ʔ",
    "ʕᵔᴥᵔʔ", "ʕ •`ᴥ•´ʔ", "V•ᴥ•V", "ฅ^•ﻌ•^ฅ", "ʕ •́؈•̀ ₎",
    "{•̃_•̃}", "(ᵔᴥᵔ)", "[¬º-°]¬", "ƪ(ړײ)‎ƪ​​", "¯\\(°_o)/¯",
    "⊙﹏⊙", "¯\\_(⊙︿⊙)_/¯", "¿ⓧ_ⓧﮌ", "(⊙.☉)7", "٩(๏_๏)۶",
    "(⊙_◎)", "ミ●﹏☉ミ", "(Ծ‸ Ծ)", "⥀.⥀", "♨_♨", "(._.)"
];

// Sort longest first so we don't accidentally leave partial matches when
// a longer emoji contains a shorter one.
ASCII_EMOJI_ARTS.sort((a, b) => b.length - a.length);

function stripAsciiEmojis(text) {
    if (!text || typeof text !== "string") return text;
    let cleaned = text;
    for (const emoji of ASCII_EMOJI_ARTS) {
        cleaned = cleaned.split(emoji).join("");
    }
    return cleaned.trim();
}

/* ------------------------------------------------------------------ */
/*  OPENAI MODERATION                                                  */
/* ------------------------------------------------------------------ */
const moderationCache = new Map(); // text -> { result, expiry }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function moderateContent(text, apiKey, imageUrl) {
    if (!apiKey) throw new Error("OpenAI API key not configured");

    // Strip ASCII emojis before moderation — the OpenAI model flags innocent
    // emoticons (e.g. Lenny face) as sexual/harassing.
    const strippedText = text ? stripAsciiEmojis(text) : "";

    if (!strippedText && !imageUrl) return { flagged: false, categories: {} };

    // Check cache (text-only, using stripped text)
    if (!imageUrl && strippedText) {
        const cached = moderationCache.get(strippedText);
        if (cached && cached.expiry > Date.now()) {
            return cached.result;
        }
    }

    let requestBody;
    if (imageUrl) {
        const input = [{ type: "image_url", image_url: { url: imageUrl } }];
        if (strippedText) {
            input.unshift({ type: "text", text: strippedText });
        }
        requestBody = {
            model: "omni-moderation-latest",
            input: input
        };
        console.log("[MODERATION] Sending image to OpenAI. Image URL length:", imageUrl.length, "hasText:", !!strippedText, "categories with image support: sexual, violence, violence/graphic, self-harm, self-harm/intent, self-harm/instructions");
    } else {
        requestBody = {
            model: "omni-moderation-latest",
            input: strippedText
        };
    }

    const callOpenAI = async () => {
        return fetch("https://api.openai.com/v1/moderations", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
    };

    let resp = await callOpenAI();

    // Retry once on 429
    if (resp.status === 429) {
        const retryAfter = resp.headers.get("retry-after");
        const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
        await new Promise(r => setTimeout(r, delayMs));
        resp = await callOpenAI();
    }

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI moderation API error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const result = data.results && data.results[0];
    if (!result) {
        console.log("[MODERATION] No results from OpenAI");
        return { flagged: false, categories: {} };
    }

    const moderationResult = {
        flagged: result.flagged === true,
        categories: result.categories || {},
        categoryScores: result.category_scores || {},
        appliedInputTypes: result.category_applied_input_types || {}
    };

    console.log("[MODERATION] OpenAI result — flagged:", moderationResult.flagged, "categories:", JSON.stringify(moderationResult.categories), "scores:", JSON.stringify(moderationResult.categoryScores), "appliedInputTypes:", JSON.stringify(moderationResult.appliedInputTypes));

    // Store in cache (text-only, using stripped text)
    if (!imageUrl && strippedText && typeof strippedText === "string") {
        moderationCache.set(strippedText, { result: moderationResult, expiry: Date.now() + CACHE_TTL_MS });
    }

    return moderationResult;
}

/* ------------------------------------------------------------------ */
/*  PIXEL ART GRID SIZE HELPER                                         */
/* ------------------------------------------------------------------ */

// Infer grid size from grid_data so we can reject unsupported sizes.
function getGridSize(gridDataStr) {
    try {
        const grid = JSON.parse(gridDataStr);
        if (Array.isArray(grid) && grid.length > 0) {
            return grid.length;
        }
    } catch (e) { }
    return null;
}

function isBlankGrid(gridDataStr) {
    try {
        const grid = JSON.parse(gridDataStr);
        if (!Array.isArray(grid)) return false;
        for (let r = 0; r < grid.length; r++) {
            const row = grid[r];
            if (!Array.isArray(row)) return false;
            for (let c = 0; c < row.length; c++) {
                if (row[c] !== 0) return false;
            }
        }
        return true;
    } catch (e) { }
    return false;
}

function formatFlaggedCategories(categories) {
    const friendlyNames = {
        sexual: "sexual content",
        hate: "hate speech",
        harassment: "harassment",
        "self-harm": "self-harm",
        "sexual/minors": "sexual content involving minors",
        "hate/threatening": "threatening hate speech",
        "violence/graphic": "graphic violence",
        violence: "violence",
        "harassment/threatening": "threatening harassment",
        "self-harm/intent": "self-harm intent",
        "self-harm/instructions": "self-harm instructions"
    };
    const flagged = Object.entries(categories)
        .filter(([key, value]) => value === true && key !== "flagged")
        .map(([key]) => friendlyNames[key] || key.replace(/\//g, " / "));
    if (flagged.length === 0) return "inappropriate content";
    if (flagged.length === 1) return flagged[0];
    return flagged.slice(0, -1).join(", ") + " and " + flagged[flagged.length - 1];
}

function moderationErrorMessage(mod) {
    const reasons = formatFlaggedCategories(mod.categories);
    return "Your message was flagged for " + reasons + " and cannot be posted.";
}

/* ------------------------------------------------------------------ */
/*  REPORT COMMENTS                                                    */
/* ------------------------------------------------------------------ */
// Every report must explain itself. The client modal checks the same rule
// before sending (js/reports.js), but the client is bypassable, so this is
// the authoritative gate for all report types.
//
// KEEP IN SYNC with hasProperWord()/reportCommentError() in js/reports.js.
const REPORT_COMMENT_MAX = 500;

function hasProperWord(text) {
    if (!text) return false;
    try {
        return new RegExp("\\p{L}{2,}", "u").test(text);
    } catch (e) {
        return /[A-Za-z]{2,}/.test(text);
    }
}

function reportCommentError(comment) {
    const text = String(comment || "").trim();
    if (!text) {
        return "Please add a comment explaining what is wrong with this content.";
    }
    if (!hasProperWord(text)) {
        return "Please write at least one word — symbols, numbers or emoji alone are not enough.";
    }
    if (text.length > REPORT_COMMENT_MAX) {
        return `Please keep the comment under ${REPORT_COMMENT_MAX} characters.`;
    }
    return "";
}

/* ------------------------------------------------------------------ */
/*  LOGGING                                                            */
/* ------------------------------------------------------------------ */
async function logAutomodRejection(uid, contentType, text, categories, accessToken, options) {
    try {
        const opts = options || {};
        const entry = {
            uid,
            contentType,
            // DM text is private: never copy it into the general automod log.
            // Categories are enough to audit the decision.
            text: opts.storeText === false ? "[redacted: private message]" : String(text || "").substring(0, 500),
            categories,
            timestamp: { ".sv": "timestamp" },
            source: "openai_moderation"
        };
        await rtdbPushWithAccessToken("automod_log", entry, accessToken);
    } catch (e) {
        console.error("Failed to log automod rejection:", e);
    }
}

/* ------------------------------------------------------------------ */
/*  RATE LIMITING (RTDB-backed token bucket, global)                   */
/* ------------------------------------------------------------------ */
// Per-user, per-content-type token-bucket state lives in the social RTDB
// so it is shared across all Cloudflare Worker isolates and cannot be
// bypassed by parallel requests or different regions.
const RATE_LIMIT_CONFIG = {
    kindlechat: { capacity: 5, refillMs: 12000 },
    topic: { capacity: 3, refillMs: 28800000 },      // 8 hours
    topic_comment: { capacity: 5, refillMs: 12000 },  // match kindlechat
    neighbourhood_post: { capacity: 5, refillMs: 300000 },
    neighbourhood_comment: { capacity: 10, refillMs: 30000 },
    // Direct messages: replies are conversational but capped per user, and
    // starting conversations is much rarer (Pro-only + acceptance gate).
    dm: { capacity: 8, refillMs: 8000 },
    dm_request: { capacity: 5, refillMs: 7200000 },   // 2 hours, plus a 3-pending cap
    report: { capacity: 60, refillMs: 3600000, refillAmount: 60 }  // 60 per hour, burst allowed
};

async function rtdbSocialGet(path, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json`;
    const resp = await fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });
    const etag = resp.headers.get("ETag") || resp.headers.get("etag");
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB get failed (${resp.status}): ${errText}`);
    }
    const data = await resp.json();
    return { data, etag };
}

async function rtdbSocialPut(path, data, etag, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json`;
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
    };
    if (etag) headers["If-Match"] = etag;
    const resp = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(data)
    });
    if (resp.status === 412) {
        return { ok: false, conflict: true };
    }
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB put failed (${resp.status}): ${errText}`);
    }
    return { ok: true };
}

async function consumeRateLimitToken(uid, contentType, accessToken, spamOpts) {
    const config = RATE_LIMIT_CONFIG[contentType];
    if (!config) return { allowed: true };

    const path = `kindlechat/server_rate_limits/${uid}/${contentType}`;
    const maxRetries = 5;
    const baseBackoffMs = 25;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { data, etag } = await rtdbSocialGet(path, accessToken);
        const now = Date.now();

        let bucket;
        if (data && typeof data.tokens === "number" && typeof data.lastRefill === "number") {
            bucket = data;
        } else {
            bucket = { tokens: config.capacity, lastRefill: now };
        }

        // Refill tokens based on elapsed time
        const elapsed = now - bucket.lastRefill;
        const refills = Math.floor(elapsed / config.refillMs);
        const refillAmount = config.refillAmount || 1;
        bucket.tokens = Math.min(config.capacity, bucket.tokens + (refills * refillAmount));
        bucket.lastRefill = bucket.lastRefill + (refills * config.refillMs);

        if (bucket.tokens < 1) {
            const retryAfter = config.refillMs - ((now - bucket.lastRefill) % config.refillMs);
            return { allowed: false, retryAfter: Math.ceil(retryAfter / 1000) };
        }

        bucket.tokens -= 1;
        bucket.updatedAt = now;

        // Repetition guard: evaluated on the bucket we already read above and
        // persisted in the same PUT, so it costs no extra Firebase operations.
        let spamBlock = null;
        if (spamOpts && typeof spamOpts.text === "string" && spamOpts.text.length) {
            const evaluation = evaluateChatRepetition(bucket.rep, spamOpts.text, now, spamOpts.isArt === true);
            bucket.rep = evaluation.rep;
            spamBlock = evaluation.blocked;
        }

        const putResult = await rtdbSocialPut(path, bucket, etag, accessToken);
        if (putResult.ok) {
            if (spamBlock) {
                return {
                    allowed: false,
                    spamBlocked: true,
                    retryAfter: spamBlock.retryAfter,
                    message: spamBlock.message
                };
            }
            return { allowed: true };
        }

        // 412 conflict — another isolate updated the bucket. Retry with backoff.
        const backoff = baseBackoffMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, backoff));
    }

    // Too many conflicts. Be safe and reject.
    return { allowed: false, retryAfter: Math.ceil(config.refillMs / 1000) };
}

/* ------------------------------------------------------------------ */
/*  DIRECT MESSAGES (social RTDB only)                                 */
/* ------------------------------------------------------------------ */
// EVERY path here lives in the rekindle-socials RTDB. DM content must never
// be written to the primary (rekindle-dd1fa) database: the chat, its reports
// and the moderation worker all operate against the social project.
const DM_THREADS_PATH = "kindlechat/dm_threads";
const DM_MESSAGES_PATH = "kindlechat/dm_messages";
const DM_USER_THREADS_PATH = "kindlechat/dm_user_threads";
const DM_PREFS_PATH = "kindlechat/dm_prefs";
const DM_BLOCKS_PATH = "kindlechat/dm_blocks";
const DM_CONFIG_PATH = "kindlechat/config";
const DM_MAX_MESSAGE = 1000;
const DM_MAX_REQUEST = 300;
const DM_MAX_PENDING_OUTGOING = 3;
const DM_FLAG_CACHE_MS = 60000;

let dmFlagCache = { key: null, value: false, ts: 0 };

// Deterministic thread id. UIDs are alphanumeric in Firebase, and sorting
// makes the id identical no matter who initiates, so two people can never
// create two parallel threads and a blocked pair can never restart.
function dmThreadId(uidA, uidB) {
    const a = String(uidA || "").trim();
    const b = String(uidB || "").trim();
    if (!a || !b || a === b) return "";
    if (!/^[A-Za-z0-9]{6,128}$/.test(a) || !/^[A-Za-z0-9]{6,128}$/.test(b)) return "";
    return "dm_" + [a, b].sort().join("_");
}

// Reports for DM messages must carry the thread id in their contentPath
// (a message id alone cannot identify the thread). This parser is strict so
// a forged path cannot reach an arbitrary RTDB location during auto-delete.
function parseDmMessagePath(path) {
    const parts = String(path || "").split("/");
    if (parts.length !== 4) return null;
    if (parts[0] !== "kindlechat" || parts[1] !== "dm_messages") return null;
    const threadId = parts[2];
    const messageId = parts[3];
    if (!/^dm_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(threadId)) return null;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) return null;
    return { threadId, messageId };
}

function dmFlagKeyForOrigin(origin) {
    // Beta gets its own switch because beta and production share the same
    // social project. Everything else (prod/lite/legacy/no-origin) uses the
    // production switch.
    return origin === "https://beta.rekindle.ink" ? "dm_beta_enabled" : "dm_enabled";
}

async function isDmEnabledForOrigin(origin, accessToken) {
    const key = dmFlagKeyForOrigin(origin);
    const now = Date.now();
    if (dmFlagCache.key === key && (now - dmFlagCache.ts) < DM_FLAG_CACHE_MS) {
        return dmFlagCache.value;
    }
    try {
        const res = await rtdbSocialGet(DM_CONFIG_PATH, accessToken);
        const value = !!(res.data && res.data[key] === true);
        dmFlagCache = { key, value, ts: now };
        return value;
    } catch (e) {
        // Fail closed: if the switch cannot be read, do not open new DMs.
        console.error("[DM] config read failed:", e.message);
        dmFlagCache = { key, value: false, ts: now };
        return false;
    }
}

async function rtdbSocialQuery(path, query, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?${query}&access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB query failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
}

async function getDmThreadWithEtag(threadId, accessToken) {
    const res = await rtdbSocialGet(`${DM_THREADS_PATH}/${threadId}`, accessToken);
    return {
        thread: res.data && typeof res.data === "object" ? res.data : null,
        etag: res.etag || null
    };
}

async function countPendingOutgoingDmRequests(uid, accessToken) {
    try {
        const data = await rtdbSocialQuery(
            `${DM_USER_THREADS_PATH}/${uid}`,
            'orderBy="status"&equalTo="pending"',
            accessToken
        );
        if (!data || typeof data !== "object") return 0;
        let count = 0;
        Object.keys(data).forEach(function (threadId) {
            const row = data[threadId];
            if (row && row.requestedBy === uid) count++;
        });
        return count;
    } catch (e) {
        // A failed count must not silently disable the cap; treat as over cap.
        console.error("[DM] pending count failed:", e.message);
        return DM_MAX_PENDING_OUTGOING;
    }
}

async function getDmAllowRequests(uid, accessToken) {
    try {
        const res = await rtdbSocialGet(`${DM_PREFS_PATH}/${uid}/allowRequests`, accessToken);
        // Missing prefs (null) means the default: requests allowed.
        return res.data !== false;
    } catch (e) {
        // Fail closed: if the preference cannot be read, do not create a new
        // conversation. The acceptance gate is a second layer, not a reason
        // to ignore an explicit opt-out.
        console.error("[DM] preference read failed:", e.message);
        return false;
    }
}

async function hasDmBlock(uidA, uidB, accessToken) {
    try {
        const [forward, reverse] = await Promise.all([
            rtdbSocialGet(`${DM_BLOCKS_PATH}/${uidA}/${uidB}`, accessToken),
            rtdbSocialGet(`${DM_BLOCKS_PATH}/${uidB}/${uidA}`, accessToken)
        ]);
        return forward.data === true || reverse.data === true;
    } catch (e) {
        // Fail closed: if the block list cannot be read, do not create a new
        // conversation (a missed request is safer than a missed block).
        console.error("[DM] block check failed:", e.message);
        return true;
    }
}

function isValidDmText(text, maxLength) {
    return typeof text === "string" && text.trim().length > 0 && text.length <= maxLength;
}

// A block overwrites the thread status, so dm_block records the status it
// replaced in blockedFromStatus. Unblocking puts the conversation back the way
// it was: an accepted conversation reopens, a pending request returns to the
// inbox for a fresh accept/decline. Threads blocked before blockedFromStatus
// existed fall back on the transition timestamps.
function dmStatusAfterUnblock(thread) {
    const prior = thread && thread.blockedFromStatus;
    if (prior === "pending" || prior === "accepted" || prior === "declined") return prior;
    if (thread && thread.acceptedAt) return "accepted";
    if (thread && thread.declinedAt) return "declined";
    return "pending";
}

function dmIndexRow(otherUid, thread, lastMessageAt, lastMessageUid) {
    const row = {
        otherUid,
        requestedBy: thread.requestedBy,
        status: thread.status,
        // Use the RTDB server timestamp so the inbox and the client's
        // lastReadAt (also a server timestamp) share one clock.
        lastMessageAt: typeof lastMessageAt === "number" ? lastMessageAt : { ".sv": "timestamp" },
        lastMessageUid: lastMessageUid || thread.requestedBy || ""
    };
    if (thread.blockedBy) row.blockedBy = thread.blockedBy;
    return row;
}

async function writeDmIndexRow(uid, threadId, row, accessToken) {
    // PATCH (not PUT): lastReadAt is written by the client and must survive
    // every new message. PATCH also creates the row on first contact.
    await rtdbPatchWithAccessToken(`${DM_USER_THREADS_PATH}/${uid}/${threadId}`, row, accessToken);
}

// Mirrors a thread status transition into both participants' inbox rows.
// Two reads here are fine: transitions are rare, and a missing row is rebuilt
// from the thread. blockedBy must be removed when the block is lifted or both
// inboxes keep showing "You blocked this person".
async function writeDmStatusToIndexRows(uid, other, threadId, thread, accessToken) {
    const myRowPath = `${DM_USER_THREADS_PATH}/${uid}/${threadId}`;
    const otherRowPath = `${DM_USER_THREADS_PATH}/${other}/${threadId}`;
    const [myRowRes, otherRowRes] = await Promise.all([
        rtdbSocialGet(myRowPath, accessToken).catch(function () { return { data: null }; }),
        rtdbSocialGet(otherRowPath, accessToken).catch(function () { return { data: null }; })
    ]);
    const myRow = (myRowRes.data && typeof myRowRes.data === "object")
        ? myRowRes.data
        : dmIndexRow(other, thread, null, thread.requestedBy);
    const otherRow = (otherRowRes.data && typeof otherRowRes.data === "object")
        ? otherRowRes.data
        : dmIndexRow(uid, thread, null, thread.requestedBy);
    myRow.status = thread.status;
    otherRow.status = thread.status;
    if (thread.blockedBy) {
        myRow.blockedBy = thread.blockedBy;
        otherRow.blockedBy = thread.blockedBy;
    } else {
        delete myRow.blockedBy;
        delete otherRow.blockedBy;
    }
    await Promise.all([
        rtdbSetWithAccessToken(myRowPath, myRow, accessToken),
        rtdbSetWithAccessToken(otherRowPath, otherRow, accessToken)
    ]);
}

function otherDmParticipant(thread, uid) {
    const participants = (thread && thread.participants) || {};
    const others = Object.keys(participants).filter(function (p) { return p !== uid; });
    return others.length === 1 ? others[0] : "";
}

// Report-scoped context. Only called when a participant reports a message, so
// moderators never get a blanket read rule on private conversations.
async function getDmReportContext(threadId, accessToken) {
    try {
        const data = await rtdbSocialQuery(
            `${DM_MESSAGES_PATH}/${threadId}`,
            'orderBy="timestamp"&limitToLast=10',
            accessToken
        );
        if (!data || typeof data !== "object") return [];
        return Object.keys(data).map(function (key) {
            const msg = data[key] || {};
            return {
                uid: msg.uid || "",
                text: String(msg.text || "").substring(0, 500),
                timestamp: typeof msg.timestamp === "number" ? msg.timestamp : 0
            };
        }).sort(function (a, b) { return a.timestamp - b.timestamp; });
    } catch (e) {
        console.error("[DM] report context fetch failed:", e.message);
        return [];
    }
}

/* ------------------------------------------------------------------ */
/*  TEXT NORMALISATION / HASHING (used by the chat repetition guard)   */
/* ------------------------------------------------------------------ */
// `kindlechat/user_recent` is retired: nothing records to it any more, so
// the per-type duplicate checks were removed rather than left spending one
// RTDB read per topic / comment / post. Chat repeats are handled by the
// bucket-backed guard below; these helpers only normalise and hash text.
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;      // exact-repeat window for chat

function normalizeForDedupe(text) {
    if (!text) return "";
    return String(text)
        .toLowerCase()
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function hashDedupeKey(text) {
    const normalized = normalizeForDedupe(text);
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    }
    return String(hash >>> 0);
}

/* ------------------------------------------------------------------ */
/*  KINDLE CHAT REPETITION GUARD                                       */
/* ------------------------------------------------------------------ */
// Repetition state lives INSIDE the existing server_rate_limits bucket, so
// this guard adds ZERO Firebase reads/writes: that bucket is already read
// and written once per message by consumeRateLimitToken().
//
// Why not kindlechat/user_recent? Those writes were fire-and-forget after
// the response had been sent (no ctx.waitUntil) and they silently stopped
// persisting: the newest entry is 2026-09-21, so exact-duplicate blocking
// had been dead for a month. That is how the 2026-10-19 "hello hello
// hello" flood went straight through. Replacing the three extra
// user_recent ops per chat message (check GET + record PUT + cleanup GET)
// with this guard is a net REDUCTION of 3 Firebase operations.
//
// Stored shape (compact string, hashes only - never message text):
//   bucket.rep = "<ts>:<textHash>:<dominantHash>:<tokHash> <tokHash>|..."
// holding the user's most recent message shapes (newest first).
const CHAT_REP_WINDOW_MS = 10 * 60 * 1000;           // near-repeat window
const CHAT_REP_DUP_WINDOW_MS = DUPLICATE_WINDOW_MS;  // 5 min, same as the old dedupe window
const CHAT_REP_SIMILARITY = 0.5;                     // Jaccard over de-duplicated token hashes
const CHAT_REP_LIMIT = 2;                            // 3rd near-identical message is rejected
const CHAT_REP_MAX_ENTRIES = 4;
const CHAT_REP_MAX_TOKENS = 16;

// Collapses character runs ("hello", "hellllo", "hhhhh...") and drops
// @mentions (conversation context, not content), so stretched spam and
// plain greetings compare equal. Character dominance is measured on the
// un-collapsed text, or a 120-character "aaaa...saaaa" mash would look
// like a three-letter word.
function chatTextShapes(text) {
    const raw = String(text || "")
        .toLowerCase()
        .replace(/(^|\s)@[a-z0-9_.\-]+/g, " ")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!raw) return { toks: [], dom: "" };
    const cleaned = raw.replace(/(.)\1+/g, "$1");
    const words = cleaned.split(" ");
    const counts = Object.create(null);
    const order = [];
    for (const w of words) {
        if (!w) continue;
        if (counts[w]) { counts[w]++; } else { counts[w] = 1; order.push(w); }
    }
    // A "dominant" token means one word (or one letter) carries the message:
    // "hello hello hello", "hi hi hi hi bhi hi", "aaaaaa". Those shapes must
    // match each other even when junk words are sprinkled in (Jaccard alone
    // dilutes them). Single-character dominants are tagged "#x" so a mashed
    // "a a a" and "aaaaaa" compare equal without colliding with words.
    let dominant = "";
    const letters = raw.replace(/\s+/g, "");
    if (letters.length >= 8) {
        const charCounts = Object.create(null);
        let topChar = "", topCharCount = 0;
        for (const ch of letters) {
            charCounts[ch] = (charCounts[ch] || 0) + 1;
            if (charCounts[ch] > topCharCount) { topCharCount = charCounts[ch]; topChar = ch; }
        }
        if (topCharCount >= Math.ceil(letters.length * 0.7)) dominant = hashDedupeKey("#" + topChar);
    }
    if (!dominant) {
        let topWord = "", topCount = 0;
        for (const w of order) {
            if (counts[w] > topCount) { topCount = counts[w]; topWord = w; }
        }
        if (words.length === 1 || topCount >= Math.max(2, Math.ceil(words.length * 0.5))) {
            dominant = topWord.length === 1 ? hashDedupeKey("#" + topWord) : hashDedupeKey(topWord);
        }
    }
    return {
        toks: order.slice(0, CHAT_REP_MAX_TOKENS).map(hashDedupeKey),
        dom: dominant
    };
}

function decodeChatRep(rep) {
    if (!rep || typeof rep !== "string") return [];
    const out = [];
    for (const part of rep.split("|")) {
        const bits = part.split(":");
        if (bits.length < 3) continue;
        const t = Number(bits[0]);
        if (!t) continue;
        out.push({ t: t, h: bits[1] || "", dom: bits[2] || "", toks: bits[3] ? bits[3].split(" ").filter(Boolean) : [] });
    }
    return out;
}

function encodeChatRep(entries) {
    return entries.map(e => e.t + ":" + e.h + ":" + (e.dom || "") + ":" + (e.toks || []).join(" ")).join("|");
}

function chatTokenOverlap(a, b) {
    if (!a.length || !b.length) return 0;
    const B = Object.create(null);
    for (const t of b) B[t] = 1;
    let shared = 0;
    for (const t of a) { if (B[t]) shared++; }
    // a and b are already de-duplicated, so this is a plain Jaccard index
    return shared / (a.length + b.length - shared);
}

function chatShapesMatch(shape, entry) {
    if (shape.dom && entry.dom && shape.dom === entry.dom) return true;
    return chatTokenOverlap(shape.toks, entry.toks) >= CHAT_REP_SIMILARITY;
}

// Returns { blocked: {retryAfter, message}|null, rep: <state to persist> }.
// The attempt is always recorded - blocked ones included - so a spammer
// cannot outlast the window by hammering send.
function evaluateChatRepetition(rep, text, now, isArt) {
    const entries = decodeChatRep(rep).filter(e => now - e.t >= 0 && now - e.t < CHAT_REP_WINDOW_MS);
    const textHash = hashDedupeKey(normalizeForDedupe(text));
    let blocked = null;

    if (isArt) {
        // Same drawing reposted (the placeholder caption must not be compared)
        for (const e of entries) {
            const age = now - e.t;
            if (e.h === textHash && age < CHAT_REP_DUP_WINDOW_MS) {
                blocked = {
                    retryAfter: Math.ceil((CHAT_REP_DUP_WINDOW_MS - age) / 1000),
                    message: "You already posted this pixel art recently. Modify it to post again."
                };
                break;
            }
        }
    } else {
        const shape = chatTextShapes(text);
        if (shape.toks.length) {
            // 1. Exact repeat within the duplicate window
            for (const e of entries) {
                const age = now - e.t;
                if (e.h === textHash && age < CHAT_REP_DUP_WINDOW_MS) {
                    blocked = {
                        retryAfter: Math.ceil((CHAT_REP_DUP_WINDOW_MS - age) / 1000),
                        message: "You just sent that message. Say something different - repeated messages are blocked to keep chat readable."
                    };
                    break;
                }
            }
            // 2. Same message reworded or stretched a few times in the window
            if (!blocked) {
                const ages = [];
                for (const e of entries) {
                    if (!e.toks.length) continue;
                    if (chatShapesMatch(shape, e)) ages.push(now - e.t);
                }
                if (ages.length >= CHAT_REP_LIMIT) {
                    ages.sort((x, y) => x - y);   // newest first
                    const wait = Math.ceil((CHAT_REP_WINDOW_MS - ages[CHAT_REP_LIMIT - 1]) / 1000);
                    blocked = {
                        retryAfter: Math.max(10, wait),
                        message: "You have sent the same message a few times. Please say something new - repeated messages are blocked to keep chat readable."
                    };
                }
            }
        }
    }

    const shape = isArt ? { toks: [], dom: "" } : chatTextShapes(text);
    const next = [{ t: now, h: textHash, dom: shape.dom, toks: shape.toks }]
        .concat(entries)
        .slice(0, CHAT_REP_MAX_ENTRIES);
    return { blocked: blocked, rep: encodeChatRep(next) };
}

/* ------------------------------------------------------------------ */
/*  LEGACY IN-MEMORY RATE LIMITER (kept for non-social types)          */
/* ------------------------------------------------------------------ */
const rateLimits = new Map();

function checkRateLimit(key, maxTokens, refillMs) {
    const now = Date.now();
    let entry = rateLimits.get(key);
    if (!entry) {
        entry = { tokens: maxTokens, lastRefill: now };
        rateLimits.set(key, entry);
    }

    const elapsed = now - entry.lastRefill;
    const refilled = Math.floor(elapsed / refillMs);
    entry.tokens = Math.min(maxTokens, entry.tokens + refilled);
    entry.lastRefill = entry.lastRefill + (refilled * refillMs);

    if (entry.tokens < 1) {
        const retryAfter = refillMs - ((now - entry.lastRefill) % refillMs);
        return { allowed: false, retryAfter };
    }

    entry.tokens -= 1;
    return { allowed: true };
}

/* Discord report notifications were removed 2026-10-25 by request: reports
   stay in /reports and the moderation console, but no Discord embed is sent.
   The /discord-interaction endpoint (buttons) remains for the old Worker. */

/* ------------------------------------------------------------------ */
/*  DISCORD INTERACTIONS                                               */
/* ------------------------------------------------------------------ */
async function verifyDiscordSignature(request, publicKey) {
    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    if (!signature || !timestamp || !publicKey) return false;

    const body = await request.clone().text();
    const message = new TextEncoder().encode(timestamp + body);

    try {
        const key = await crypto.subtle.importKey(
            "raw",
            hexToUint8Array(publicKey),
            { name: "Ed25519" },
            false,
            ["verify"]
        );
        return await crypto.subtle.verify("Ed25519", key, hexToUint8Array(signature), message);
    } catch (e) {
        console.error("[DISCORD] Signature verification failed:", e.message);
        return false;
    }
}

function hexToUint8Array(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

async function handleDiscordInteraction(request, env) {
    const publicKey = env.DISCORD_PUBLIC_KEY;
    if (!publicKey) {
        return new Response(JSON.stringify({ error: "DISCORD_PUBLIC_KEY not configured" }), { status: 500 });
    }

    const isValid = await verifyDiscordSignature(request, publicKey);
    if (!isValid) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
    }

    const body = await request.json();

    // Handle PING (Discord verification)
    if (body.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Handle button clicks
    if (body.type === 3 && body.data?.component_type === 2) {
        const customId = body.data.custom_id;
        const [action, contentType, contentId, reportedUserId] = customId.split(":");
        const accessToken = await getCachedAccessToken(env);

        let message = "";
        let success = false;

        try {
            if (action === "delete") {
                let contentPath = getContentPath(contentType, contentId);
                // A comment id does not identify its parent post/topic, and a
                // DM message id only identifies its thread, so fall back to the
                // path stored on the pending report (getContentPath returns ""
                // for those types).
                if (!contentPath) {
                    const report = await getExistingPendingReport(contentType, contentId, accessToken);
                    if (report && report.contentPath) contentPath = report.contentPath;
                }
                const deleted = await autoDeleteContent(contentType, contentId, contentPath, accessToken);
                if (deleted) {
                    message = "Content deleted successfully.";
                    success = true;
                } else {
                    message = "Failed to delete content. It may have already been removed.";
                }
            } else if (action === "timeout") {
                if (reportedUserId) {
                    const until = Date.now() + (24 * 3600000);
                    await rtdbPushWithAccessToken(`timeouts/${reportedUserId}`, {
                        until,
                        reason: "Discord moderation action",
                        moderatorUid: "discord",
                        moderatorName: "Discord",
                        createdAt: Date.now()
                    }, accessToken);
                    message = `User timed out for 24 hours.`;
                    success = true;
                } else {
                    message = "No user ID available for timeout.";
                }
            } else if (action === "dismiss") {
                message = "Report dismissed.";
                success = true;
            }
        } catch (e) {
            message = `Action failed: ${e.message}`;
            console.error("[DISCORD] Action failed:", e);
        }

        return new Response(JSON.stringify({
            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
            data: {
                content: success ? `✅ ${message}` : `❌ ${message}`,
                flags: 64 // EPHEMERAL
            }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown interaction type" }), { status: 400 });
}

function getContentPath(contentType, contentId) {
    if (contentType === "kindlechat") return `kindlechat/messages/${contentId}`;
    if (contentType === "topic") return `topics/${contentId}`;
    if (contentType === "neighbourhood_post") return `neighbourhood_posts/${contentId}`;
    if (contentType === "suggestion") return `suggestions/${contentId}`;
    // Comment ids are only unique inside their parent document, so the parent
    // path has to come from the stored report's contentPath. The same is true
    // for DM messages (only unique inside their thread) and suggestion
    // comments (inside their suggestion). See handleDiscordInteraction.
    if (contentType === "topic_comment") return "";
    if (contentType === "neighbourhood_comment") return "";
    if (contentType === "suggestion_comment") return "";
    if (contentType === "dm_message") return "";
    return "";
}

/* ------------------------------------------------------------------ */
/*  MAIN HANDLER                                                       */
/* ------------------------------------------------------------------ */
export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        const headers = corsHeaders(origin);
        const url = new URL(request.url);

        // --- DISCORD INTERACTIONS ENDPOINT ---
        if (request.method === "POST" && url.pathname === "/discord-interaction") {
            return handleDiscordInteraction(request, env);
        }

        // --- HEALTH / DIAGNOSTICS ENDPOINT ---
        if (request.method === "GET" && url.pathname === "/health") {
            try {
                const sa = resolveServiceAccount(env);
                const token = await getGoogleAccessToken(env);
                return new Response(JSON.stringify({
                    ok: true,
                    serviceAccountEmail: sa.clientEmail,
                    serviceAccountProjectId: sa.projectId,
                    firebaseProjectId: env.FIREBASE_PROJECT_ID || null,
                    googleTokenPrefix: token ? token.substring(0, 20) + "..." : null,
                    openaiKeySet: !!env.OPENAI_API_KEY
                }), { status: 200, headers });
            } catch (e) {
                return new Response(JSON.stringify({
                    ok: false,
                    error: e.message
                }), { status: 500, headers });
            }
        }

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers });
        }

        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
        }

        try {
            const authHeader = request.headers.get("Authorization");
            const token = authHeader ? authHeader.split(" ")[1] : null;
            if (!token) {
                return new Response(JSON.stringify({ error: "Missing authorization token" }), { status: 401, headers });
            }

            const payload = await verifyFirebaseToken(token, env);
            const uid = payload.sub;
            const email = payload.email || "";
            const username = email.split("@")[0];
            const isAdmin = email === "ukiyo@rekindle.ink";

            const body = await request.json();
            const { type, text } = body;

            if (!type) {
                return new Response(JSON.stringify({ error: "Missing type" }), { status: 400, headers });
            }

            const accessToken = await getCachedAccessToken(env);

            // --- TIMEOUT CHECK ---
            // Reports and DM safety actions (accept/decline/block/unblock) must
            // remain available even to a timed-out user; only content writes
            // are blocked by a timeout.
            const TIMEOUT_EXEMPT_TYPES = ["report", "dm_accept", "dm_decline", "dm_block", "dm_unblock"];
            if (!TIMEOUT_EXEMPT_TYPES.includes(type)) {
                const timeoutCheck = await checkTimeout(uid, env, token, accessToken);
                if (timeoutCheck.timedOut) {
                    return new Response(JSON.stringify({
                        error: `You are timed out. Please wait ${timeoutCheck.remainingMinutes} minute(s) before posting.`
                    }), { status: 403, headers });
                }
            }

            // --- KINDLECHAT ---
            if (type === "kindlechat") {
                const trimmed = String(text).substring(0, 1000);
                const hasFlipnote = body.flipnote_data && typeof body.flipnote_data === "object";
                const hasPixelArt = body.pixel_art && typeof body.pixel_art === "string";
                if (!trimmed && !hasFlipnote && !hasPixelArt) {
                    return new Response(JSON.stringify({ error: "Empty message" }), { status: 400, headers });
                }
                if (containsUrl(trimmed)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(trimmed)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }
                if (containsDih(trimmed)) {
                    return new Response(JSON.stringify({ error: "That word is not allowed." }), { status: 400, headers });
                }

                const isFlipnote = body.is_flipnote === true;
                const isPixelArt = body.is_pixel_art === true;

                // Rate limit + repetition guard in a single RTDB round-trip.
                // The repetition state rides on the rate-limit bucket, so this
                // replaces the old user_recent duplicate checks (3 ops/message)
                // without adding any Firebase reads or writes.
                // Flipbooks are skipped: their placeholder caption is shared by
                // every flipbook, so comparing captions would false-positive.
                let spamOpts = null;
                if (!isFlipnote) {
                    spamOpts = isPixelArt
                        ? { text: String(body.grid_data || ""), isArt: true }
                        : { text: trimmed, isArt: false };
                }
                const rl = await consumeRateLimitToken(uid, "kindlechat", accessToken, spamOpts);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({
                        allowed: false,
                        error: rl.message || `Rate limit exceeded. Please wait ${rl.retryAfter} second(s) before posting.`,
                        retryAfter: rl.retryAfter
                    }), { status: 429, headers });
                }

                const skipOpenAIModeration = isFlipnote || isPixelArt;

                // Moderation: text-only messages are checked; pixel art / flipbook bypass OpenAI.
                if (!skipOpenAIModeration && trimmed) {
                    const mod = await moderateContent(trimmed, env.OPENAI_API_KEY);
                    if (mod.flagged) {
                        await logAutomodRejection(uid, "kindlechat", trimmed, mod.categories, accessToken);
                        return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                    }
                }

                const msgData = {
                    uid,
                    timestamp: { ".sv": "timestamp" },
                    text: trimmed
                };
                // Allow known extra fields from client
                const allowedExtras = ["pixel_art", "grid_data", "is_pixel_art", "is_flipnote", "flipnote_data", "replyTo"];
                for (const key of allowedExtras) {
                    if (key in body) msgData[key] = body[key];
                }

                const pixelArt = body.pixel_art || null;
                const gridSize = getGridSize(body.grid_data);
                console.log("[WORKER] kindlechat request — isFlipnote:", isFlipnote, "isPixelArt:", isPixelArt, "hasPixelArt:", !!pixelArt, "pixelArtLength:", pixelArt ? pixelArt.length : 0, "pixelArtIsBase64:", pixelArt ? pixelArt.startsWith("data:image") : false, "gridSize:", gridSize, "skipOpenAIModeration:", skipOpenAIModeration);

                if (gridSize === 64) {
                    return new Response(JSON.stringify({ error: "64× pixel art is not supported in chat." }), { status: 400, headers });
                }

                if (isPixelArt && isBlankGrid(body.grid_data)) {
                    return new Response(JSON.stringify({ error: "Blank pixel art cannot be posted." }), { status: 400, headers });
                }

                console.log("[WORKER] kindlechat post — token claims:", { email: payload.email, ageVerified: payload.ageVerified, moderator: payload.moderator, aud: payload.aud });
                const result = await rtdbPushWithAccessToken("kindlechat/messages", msgData, accessToken);

                // Maintain a lightweight art index so the KindleChat gallery can load only art posts.
                if (isFlipnote || isPixelArt) {
                    const thumbnail = isPixelArt ? (body.pixel_art || null) : (isFlipnote && body.flipnote_data && body.flipnote_data.frames && body.flipnote_data.frames.length > 0 ? body.flipnote_data.frames[0] : null);
                    const artIndexEntry = {
                        uid,
                        type: isPixelArt ? "pixel_art" : "flipbook",
                        timestamp: { ".sv": "timestamp" },
                        thumbnail,
                        text: trimmed || ""
                    };
                    await rtdbSetWithAccessToken(`kindlechat/art_index/${result.name}`, artIndexEntry, accessToken).catch(e => console.error("[WORKER] art_index write failed:", e.message));
                }

                // Duplicate/repetition state was already recorded on the
                // rate-limit bucket by consumeRateLimitToken() above.

                return new Response(JSON.stringify({ allowed: true, key: result.name }), { status: 200, headers });
            }

            // --- DIRECT MESSAGE REQUEST ---
            // Pro members start the conversation; every first contact is a
            // moderated request that the recipient must accept. All DM data is
            // written by this worker into the SOCIAL RTDB.
            if (type === "dm_request") {
                const toUid = typeof body.toUid === "string" ? body.toUid.trim() : "";
                const text = typeof body.text === "string" ? body.text : "";

                if (!toUid || toUid === uid) {
                    return new Response(JSON.stringify({
                        error: toUid === uid ? "You can't message yourself." : "Choose a user to message."
                    }), { status: 400, headers });
                }
                if (!/^[A-Za-z0-9]{6,128}$/.test(toUid)) {
                    return new Response(JSON.stringify({ error: "Invalid recipient." }), { status: 400, headers });
                }

                const threadId = dmThreadId(uid, toUid);
                if (!threadId) {
                    return new Response(JSON.stringify({ error: "Invalid recipient." }), { status: 400, headers });
                }

                if (!(await isDmEnabledForOrigin(origin, accessToken))) {
                    return new Response(JSON.stringify({
                        error: "Direct messages are temporarily unavailable.",
                        code: "dm_disabled"
                    }), { status: 403, headers });
                }

                // Only ReKindle+ members may start new conversations. The
                // recipient can be any age-verified user.
                if (payload.pro !== true) {
                    return new Response(JSON.stringify({
                        error: "ReKindle+ is required to start new conversations.",
                        code: "pro_required"
                    }), { status: 403, headers });
                }
                if (payload.ageVerified !== true) {
                    return new Response(JSON.stringify({
                        error: "Age verification is required to send direct messages.",
                        code: "age_required"
                    }), { status: 403, headers });
                }

                if (!isValidDmText(text, DM_MAX_REQUEST)) {
                    return new Response(JSON.stringify({
                        error: `Message requests must be 1-${DM_MAX_REQUEST} characters.`
                    }), { status: 400, headers });
                }
                if (containsUrl(text)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(text)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }
                if (containsDih(text)) {
                    return new Response(JSON.stringify({ error: "That word is not allowed." }), { status: 400, headers });
                }

                const rl = await consumeRateLimitToken(uid, "dm_request", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({
                        allowed: false,
                        error: `Too many message requests. Please wait ${rl.retryAfter} second(s).`,
                        retryAfter: rl.retryAfter
                    }), { status: 429, headers });
                }

                // If a thread already exists, the caller is a participant, so
                // it is safe (and more useful) to report an accepted thread even
                // if the recipient has since turned requests off.
                const existing = await getDmThreadWithEtag(threadId, accessToken);
                if (existing.thread) {
                    if (existing.thread.status === "accepted") {
                        return new Response(JSON.stringify({
                            error: "You already have a conversation with this person.",
                            code: "dm_exists",
                            threadId
                        }), { status: 409, headers });
                    }
                    return new Response(JSON.stringify({
                        error: "This person can't receive message requests right now."
                    }), { status: 409, headers });
                }

                const pendingOutgoing = await countPendingOutgoingDmRequests(uid, accessToken);
                if (pendingOutgoing >= DM_MAX_PENDING_OUTGOING) {
                    return new Response(JSON.stringify({
                        error: `You can have at most ${DM_MAX_PENDING_OUTGOING} unanswered message requests. Wait for a reply or cancellation before starting another.`,
                        code: "dm_pending_cap"
                    }), { status: 429, headers });
                }

                if (!(await getDmAllowRequests(toUid, accessToken))) {
                    return new Response(JSON.stringify({
                        error: "This person can't receive message requests right now."
                    }), { status: 403, headers });
                }
                if (await hasDmBlock(uid, toUid, accessToken)) {
                    // Never reveal who blocked whom.
                    return new Response(JSON.stringify({
                        error: "This person can't receive message requests right now."
                    }), { status: 403, headers });
                }

                const mod = await moderateContent(text, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "dm_request", text, mod.categories, accessToken, { storeText: false });
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const thread = {
                    participants: { [uid]: true, [toUid]: true },
                    requestedBy: uid,
                    status: "pending",
                    createdAt: { ".sv": "timestamp" }
                };

                try {
                    await rtdbSetWithAccessToken(`${DM_THREADS_PATH}/${threadId}`, thread, accessToken);
                    const messageResult = await rtdbPushWithAccessToken(`${DM_MESSAGES_PATH}/${threadId}`, {
                        uid,
                        text,
                        timestamp: { ".sv": "timestamp" }
                    }, accessToken);
                    await Promise.all([
                        writeDmIndexRow(uid, threadId, dmIndexRow(toUid, thread, null, uid), accessToken),
                        writeDmIndexRow(toUid, threadId, dmIndexRow(uid, thread, null, uid), accessToken)
                    ]);
                    console.log("[DM] request created:", threadId);
                    return new Response(JSON.stringify({
                        success: true,
                        threadId,
                        messageId: messageResult.name
                    }), { status: 200, headers });
                } catch (e) {
                    // Best-effort rollback so a partial write does not leave an
                    // invisible half-thread behind.
                    await rtdbDeleteWithAccessToken(`${DM_THREADS_PATH}/${threadId}`, accessToken).catch(function () { });
                    await rtdbDeleteWithAccessToken(`${DM_MESSAGES_PATH}/${threadId}`, accessToken).catch(function () { });
                    await rtdbDeleteWithAccessToken(`${DM_USER_THREADS_PATH}/${uid}/${threadId}`, accessToken).catch(function () { });
                    await rtdbDeleteWithAccessToken(`${DM_USER_THREADS_PATH}/${toUid}/${threadId}`, accessToken).catch(function () { });
                    throw e;
                }
            }

            // --- DIRECT MESSAGE REPLY ---
            if (type === "dm_message") {
                const threadId = typeof body.threadId === "string" ? body.threadId : "";
                const text = typeof body.text === "string" ? body.text : "";

                if (!/^dm_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(threadId)) {
                    return new Response(JSON.stringify({ error: "Invalid conversation." }), { status: 400, headers });
                }
                if (!(await isDmEnabledForOrigin(origin, accessToken))) {
                    return new Response(JSON.stringify({
                        error: "Direct messages are temporarily unavailable.",
                        code: "dm_disabled"
                    }), { status: 403, headers });
                }
                if (!isValidDmText(text, DM_MAX_MESSAGE)) {
                    return new Response(JSON.stringify({
                        error: `Messages must be 1-${DM_MAX_MESSAGE} characters.`
                    }), { status: 400, headers });
                }
                if (containsUrl(text)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(text)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }
                if (containsDih(text)) {
                    return new Response(JSON.stringify({ error: "That word is not allowed." }), { status: 400, headers });
                }

                const { thread } = await getDmThreadWithEtag(threadId, accessToken);
                if (!thread || !thread.participants || thread.participants[uid] !== true) {
                    return new Response(JSON.stringify({ error: "Conversation not found." }), { status: 404, headers });
                }
                if (thread.status !== "accepted") {
                    return new Response(JSON.stringify({
                        error: "This conversation is not open.",
                        code: "dm_not_open"
                    }), { status: 403, headers });
                }

                const rl = await consumeRateLimitToken(uid, "dm", accessToken, { text, isArt: false });
                if (!rl.allowed) {
                    return new Response(JSON.stringify({
                        allowed: false,
                        error: rl.message || `Please wait ${rl.retryAfter} second(s) before sending another message.`,
                        retryAfter: rl.retryAfter
                    }), { status: 429, headers });
                }

                const mod = await moderateContent(text, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "dm", text, mod.categories, accessToken, { storeText: false });
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const result = await rtdbPushWithAccessToken(`${DM_MESSAGES_PATH}/${threadId}`, {
                    uid,
                    text,
                    timestamp: { ".sv": "timestamp" }
                }, accessToken);

                const other = otherDmParticipant(thread, uid);
                if (other) {
                    // The message itself is the source of truth. If an inbox
                    // index write fails, do NOT report failure to the sender
                    // (they would resend and duplicate the message); log it for
                    // a repair instead.
                    await Promise.all([
                        writeDmIndexRow(uid, threadId, dmIndexRow(other, thread, null, uid), accessToken),
                        writeDmIndexRow(other, threadId, dmIndexRow(uid, thread, null, uid), accessToken)
                    ]).catch(function (e) {
                        console.error("[DM] index update failed after message write:", e.message);
                    });
                }

                return new Response(JSON.stringify({ success: true, messageId: result.name }), { status: 200, headers });
            }

            // --- DM ACCEPT / DECLINE / BLOCK / UNBLOCK ---
            // These are deliberately NOT behind the Pro check or the kill
            // switch: a recipient must always be able to accept, decline,
            // block or unblock, including while timed out.
            if (type === "dm_accept" || type === "dm_decline" || type === "dm_block" || type === "dm_unblock") {
                const threadId = typeof body.threadId === "string" ? body.threadId : "";
                if (!/^dm_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(threadId)) {
                    return new Response(JSON.stringify({ error: "Invalid conversation." }), { status: 400, headers });
                }

                const { thread, etag } = await getDmThreadWithEtag(threadId, accessToken);
                if (!thread || !thread.participants || thread.participants[uid] !== true) {
                    return new Response(JSON.stringify({ error: "Conversation not found." }), { status: 404, headers });
                }

                const other = otherDmParticipant(thread, uid);
                if (!other) {
                    return new Response(JSON.stringify({ error: "Conversation not found." }), { status: 404, headers });
                }

                if (type === "dm_unblock") {
                    if (thread.status !== "blocked") {
                        // Idempotent: a retried unblock is not an error.
                        return new Response(JSON.stringify({
                            success: true,
                            status: thread.status
                        }), { status: 200, headers });
                    }
                    if (thread.blockedBy !== uid) {
                        // Only the blocker can lift their own block. The blocked
                        // party gets the same generic answer as their closed
                        // banner, so this action never reveals who blocked whom.
                        return new Response(JSON.stringify({ error: "This conversation is closed." }), { status: 403, headers });
                    }

                    // Remove the caller's block first: if a later write fails,
                    // the thread status still enforces the block, never the
                    // reverse.
                    await rtdbDeleteWithAccessToken(`${DM_BLOCKS_PATH}/${uid}/${other}`, accessToken);

                    // dm_block's idempotent branch lets the other participant
                    // block back. Their block outlives this unblock, so the
                    // thread stays closed and ownership moves to them.
                    let otherBlocked = false;
                    try {
                        const reverse = await rtdbSocialGet(`${DM_BLOCKS_PATH}/${other}/${uid}`, accessToken);
                        otherBlocked = reverse.data === true;
                    } catch (e) {
                        // Fail closed: an unreadable block list must not
                        // resurrect a conversation someone may have blocked.
                        console.error("[DM] reverse block check failed:", e.message);
                        otherBlocked = true;
                    }

                    const restored = Object.assign({}, thread);
                    restored.unblockedAt = { ".sv": "timestamp" };
                    if (otherBlocked) {
                        restored.status = "blocked";
                        restored.blockedBy = other;
                        restored.blockedAt = { ".sv": "timestamp" };
                    } else {
                        restored.status = dmStatusAfterUnblock(thread);
                        delete restored.blockedBy;
                        delete restored.blockedAt;
                        delete restored.blockedFromStatus;
                    }

                    const unblockPut = await rtdbSocialPut(`${DM_THREADS_PATH}/${threadId}`, restored, etag, accessToken);
                    if (!unblockPut.ok) {
                        return new Response(JSON.stringify({ error: "Conversation changed. Please try again." }), { status: 409, headers });
                    }

                    await writeDmStatusToIndexRows(uid, other, threadId, restored, accessToken);
                    console.log("[DM] unblocked:", threadId, restored.status);

                    return new Response(JSON.stringify({
                        success: true,
                        status: restored.status,
                        blockedBy: restored.blockedBy || null
                    }), { status: 200, headers });
                }

                if (type === "dm_accept") {
                    if (thread.status === "accepted") {
                        return new Response(JSON.stringify({ success: true, status: "accepted" }), { status: 200, headers });
                    }
                    if (thread.status !== "pending") {
                        return new Response(JSON.stringify({ error: "This message request is no longer available." }), { status: 409, headers });
                    }
                    if (thread.requestedBy === uid) {
                        return new Response(JSON.stringify({ error: "Only the recipient can accept this request." }), { status: 403, headers });
                    }
                }

                if (type === "dm_decline") {
                    if (thread.status === "declined") {
                        return new Response(JSON.stringify({ success: true, status: "declined" }), { status: 200, headers });
                    }
                    if (thread.status !== "pending") {
                        return new Response(JSON.stringify({ error: "This message request is no longer available." }), { status: 409, headers });
                    }
                    if (thread.requestedBy === uid) {
                        return new Response(JSON.stringify({ error: "Only the recipient can decline this request." }), { status: 403, headers });
                    }
                }

                if (type === "dm_block" && thread.status === "blocked") {
                    // Idempotent: make sure the block record exists too.
                    await rtdbSetWithAccessToken(`${DM_BLOCKS_PATH}/${uid}/${other}`, true, accessToken).catch(function () { });
                    return new Response(JSON.stringify({ success: true, status: "blocked" }), { status: 200, headers });
                }

                const updated = Object.assign({}, thread);
                if (type === "dm_accept") {
                    updated.status = "accepted";
                    updated.acceptedAt = { ".sv": "timestamp" };
                } else if (type === "dm_decline") {
                    updated.status = "declined";
                    updated.declinedAt = { ".sv": "timestamp" };
                } else {
                    updated.status = "blocked";
                    updated.blockedBy = uid;
                    updated.blockedAt = { ".sv": "timestamp" };
                    // Remember what the block replaced so dm_unblock can put
                    // the conversation back the way it was.
                    updated.blockedFromStatus = thread.status;
                }

                const putResult = await rtdbSocialPut(`${DM_THREADS_PATH}/${threadId}`, updated, etag, accessToken);
                if (!putResult.ok) {
                    return new Response(JSON.stringify({ error: "Conversation changed. Please try again." }), { status: 409, headers });
                }

                if (type === "dm_block") {
                    await rtdbSetWithAccessToken(`${DM_BLOCKS_PATH}/${uid}/${other}`, true, accessToken);
                }

                await writeDmStatusToIndexRows(uid, other, threadId, updated, accessToken);

                return new Response(JSON.stringify({ success: true, status: updated.status }), { status: 200, headers });
            }

            // --- TOPIC ---
            if (type === "topic") {
                const title = (body.title || "").trim();
                const subheading = (body.subheading || "").trim();
                const icon = body.icon;
                const poll = body.poll || null;

                if (!title || title.length > 20) {
                    return new Response(JSON.stringify({ error: "Title must be 1-20 characters." }), { status: 400, headers });
                }
                if (subheading.length > 35) {
                    return new Response(JSON.stringify({ error: "Subheading must be 0-35 characters." }), { status: 400, headers });
                }
                if (!icon || typeof icon !== "string") {
                    return new Response(JSON.stringify({ error: "Icon is required." }), { status: 400, headers });
                }
                if (containsUrl(title) || containsUrl(subheading)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(title) || containsPromotedTerm(subheading)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }

                // Validate poll if provided
                let validatedPoll = null;
                if (poll && typeof poll === "object") {
                    const question = (poll.question || "").trim();
                    const options = Array.isArray(poll.options) ? poll.options.map(o => String(o || "").trim()).filter(o => o.length > 0) : [];
                    if (question.length < 1 || question.length > 100) {
                        return new Response(JSON.stringify({ error: "Poll question must be 1-100 characters." }), { status: 400, headers });
                    }
                    if (options.length < 2 || options.length > 4) {
                        return new Response(JSON.stringify({ error: "Poll must have 2-4 options." }), { status: 400, headers });
                    }
                    const invalidOption = options.find(o => o.length > 50);
                    if (invalidOption) {
                        return new Response(JSON.stringify({ error: "Poll options must be 50 characters or less." }), { status: 400, headers });
                    }
                    validatedPoll = { question, options };
                }
                if (validatedPoll) {
                    if (containsUrl(validatedPoll.question) || validatedPoll.options.some(function(o) { return containsUrl(o); })) {
                        return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                    }
                    if (containsPromotedTerm(validatedPoll.question) || validatedPoll.options.some(function(o) { return containsPromotedTerm(o); })) {
                        return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                    }
                }

                // Rate limit: token bucket (no bypass)
                const rl = await consumeRateLimitToken(uid, "topic", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ error: `Rate limit exceeded. You can create ${RATE_LIMIT_CONFIG.topic.capacity} topics every ${Math.round(RATE_LIMIT_CONFIG.topic.refillMs / 3600000)} hours. Please wait ${rl.retryAfter} second(s).`, retryAfter: rl.retryAfter }), { status: 429, headers });
                }

                // Moderation
                let textToModerate = title + " " + subheading;
                if (validatedPoll) {
                    textToModerate += " " + validatedPoll.question + " " + validatedPoll.options.join(" ");
                }
                const mod = await moderateContent(textToModerate, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "topic", textToModerate, mod.categories, accessToken);
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const topicData = {
                    title,
                    subheading,
                    body: "",
                    icon,
                    authorId: uid,
                    timestamp: new Date(),
                    lastActive: new Date(),
                    commentCount: 0
                };
                if (validatedPoll) {
                    topicData.poll = validatedPoll;
                }
                const id = await firestoreCreate("topics", topicData, accessToken);

                return new Response(JSON.stringify({ success: true, id }), { status: 200, headers });
            }

            // --- TOPIC COMMENT ---
            if (type === "topic_comment") {
                const topicId = body.topicId;
                const rawBody = (body.body || "").trim();

                if (!topicId) {
                    return new Response(JSON.stringify({ error: "Missing topic ID." }), { status: 400, headers });
                }
                if (!rawBody || rawBody.length > 1000) {
                    return new Response(JSON.stringify({ error: "Comment must be 1-1000 characters." }), { status: 400, headers });
                }
                if (containsUrl(rawBody)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(rawBody)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }

                const commentText = rawBody.replace(/(\n\s*){3,}/g, "\n\n").trim();

                // Rate limit: token bucket (no bypass) - matches kindlechat rates
                const rl = await consumeRateLimitToken(uid, "topic_comment", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ error: `Rate limit exceeded. Please wait ${rl.retryAfter} second(s) before commenting.`, retryAfter: rl.retryAfter }), { status: 429, headers });
                }

                // Moderation
                const mod = await moderateContent(commentText, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "topic_comment", commentText, mod.categories, accessToken);
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                // Create comment
                const commentId = await firestoreCreate(`topics/${topicId}/comments`, {
                    body: commentText,
                    authorId: uid,
                    timestamp: new Date()
                }, accessToken);

                // Atomically increment commentCount and update lastActive
                try {
                    await firestoreCommitTransform(`topics/${topicId}`, [
                        { fieldPath: "commentCount", increment: { integerValue: "1" } },
                        { fieldPath: "lastActive", setToServerValue: "REQUEST_TIME" }
                    ], accessToken);
                } catch (e) {
                    console.error("Error incrementing topic commentCount:", e);
                }

                // Read back the new count for the client
                let newCount = 1;
                try {
                    const topicResp = await fetch(`https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/topics/${topicId}`, {
                        headers: { "Authorization": `Bearer ${accessToken}` }
                    });
                    if (topicResp.ok) {
                        const topicDoc = await topicResp.json();
                        const countField = topicDoc.fields?.commentCount;
                        newCount = countField ? (countField.integerValue ? parseInt(countField.integerValue) : countField.doubleValue || 0) : 0;
                    }
                } catch (e) {
                    console.error("Error fetching topic count after increment:", e);
                }

                return new Response(JSON.stringify({ success: true, id: commentId, commentCount: newCount }), { status: 200, headers });
            }

            // --- NEIGHBOURHOOD POST ---
            if (type === "neighbourhood_post") {
                const trimmed = String(text).trim();
                const wordCount = trimmed.split(/\s+/).length;

                if (wordCount < 10) {
                    return new Response(JSON.stringify({ error: "Keep it meaningful! Minimum 10 words." }), { status: 400, headers });
                }
                if (trimmed.length > 280) {
                    return new Response(JSON.stringify({ error: "Message too long (max 280 chars)." }), { status: 400, headers });
                }
                if (containsUrl(trimmed)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(trimmed)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }

                // Rate limit: token bucket (no bypass)
                const rl = await consumeRateLimitToken(uid, "neighbourhood_post", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ error: `Rate limit exceeded. Please wait ${rl.retryAfter} second(s) before posting.`, retryAfter: rl.retryAfter }), { status: 429, headers });
                }

                // Moderation
                const mod = await moderateContent(trimmed, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "neighbourhood_post", trimmed, mod.categories, accessToken);
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const id = await firestoreCreate("neighbourhood_posts", {
                    uid,
                    text: trimmed,
                    timestamp: new Date()
                }, accessToken);

                return new Response(JSON.stringify({ success: true, id }), { status: 200, headers });
            }

            // --- NEIGHBOURHOOD COMMENT ---
            if (type === "neighbourhood_comment") {
                const postId = body.postId;
                const trimmed = String(text).trim();

                if (!postId) {
                    return new Response(JSON.stringify({ error: "Missing post ID." }), { status: 400, headers });
                }
                if (trimmed.length < 2 || trimmed.length > 200) {
                    return new Response(JSON.stringify({ error: "Comment must be 2-200 characters." }), { status: 400, headers });
                }
                if (containsUrl(trimmed)) {
                    return new Response(JSON.stringify({ error: "Links and URLs are not allowed." }), { status: 400, headers });
                }
                if (containsPromotedTerm(trimmed)) {
                    return new Response(JSON.stringify({ error: "Promotional content is not allowed." }), { status: 400, headers });
                }

                // Rate limit: token bucket (no bypass)
                const rl = await consumeRateLimitToken(uid, "neighbourhood_comment", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ error: `Rate limit exceeded. Please wait ${rl.retryAfter} second(s) before commenting.`, retryAfter: rl.retryAfter }), { status: 429, headers });
                }

                // Moderation
                const mod = await moderateContent(trimmed, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "neighbourhood_comment", trimmed, mod.categories, accessToken);
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const id = await firestoreCreate(`neighbourhood_posts/${postId}/comments`, {
                    uid,
                    text: trimmed,
                    timestamp: new Date()
                }, accessToken);

                // Keep the denormalised counter on the post in step. The feed
                // renders it straight from the post document, so showing a
                // count never costs a read of the comments subcollection.
                // Rules allow a commentCount-only update from any age-verified
                // client, so the client can do the same on delete.
                try {
                    await firestoreCommitTransform(`neighbourhood_posts/${postId}`, [
                        { fieldPath: "commentCount", increment: { integerValue: "1" } }
                    ], accessToken);
                } catch (e) {
                    console.error("Error incrementing neighbourhood commentCount:", e);
                }

                return new Response(JSON.stringify({ success: true, id }), { status: 200, headers });
            }

            // --- REPORT ---
            if (type === "report") {
                const { contentType, contentId, contentPath, reportedUserId, reason, comment, contentSnapshot } = body;
                
                if (!contentType || !contentId || !reason) {
                    return new Response(JSON.stringify({ error: "Missing required report fields." }), { status: 400, headers });
                }
                
                const validContentTypes = ["kindlechat", "topic", "topic_comment", "neighbourhood_post", "neighbourhood_comment", "suggestion", "suggestion_comment", "dm_message"];
                if (!validContentTypes.includes(contentType)) {
                    return new Response(JSON.stringify({ error: "Invalid content type." }), { status: 400, headers });
                }
                
                // Content that one report used to remove outright. Since
                // 2026-10-26 a single report only removes it when moderation
                // confirms the content, or when a second person reports it:
                // the board had repeat reports of one user deleting other
                // people's messages, and every message already passed
                // moderation on the way in, so a re-check usually finds
                // nothing. See docs/agent/moderation-reports.md.
                const IMMEDIATE_DELETE_TYPES = ["kindlechat", "topic_comment", "neighbourhood_comment", "suggestion_comment", "dm_message"];
                // Content that requires two reports from different users
                const TWO_REPORT_DELETE_TYPES = ["topic", "neighbourhood_post", "suggestion"];
                const isImmediateType = IMMEDIATE_DELETE_TYPES.includes(contentType);
                
                // Validate lengths
                // A report without a real explanation is not actionable, so it
                // never reaches /reports. Applies to every contentType, and is
                // checked before the rate limiter so bad requests are free.
                const reportCommentProblem = reportCommentError(comment);
                if (reportCommentProblem) {
                    return new Response(JSON.stringify({ error: reportCommentProblem }), { status: 400, headers });
                }
                if (contentSnapshot && contentSnapshot.length > 2000) {
                    return new Response(JSON.stringify({ error: "Content snapshot is too long (max 2000 characters)." }), { status: 400, headers });
                }

                // DM reports: the client only supplies ids. Derive the content
                // path, author and snapshot from the social RTDB after proving
                // the reporter is a participant. This stops a forged report
                // from auto-deleting someone else's message.
                let reportContentPath = contentPath || "";
                let reportReportedUserId = reportedUserId || "";
                let reportContentSnapshot = (contentSnapshot || "").substring(0, 2000);
                let dmContext = null;
                if (contentType === "dm_message") {
                    const parsed = parseDmMessagePath(contentPath);
                    if (!parsed || parsed.messageId !== contentId) {
                        return new Response(JSON.stringify({ error: "Invalid DM report path." }), { status: 400, headers });
                    }
                    const { thread } = await getDmThreadWithEtag(parsed.threadId, accessToken);
                    if (!thread || !thread.participants || thread.participants[uid] !== true) {
                        return new Response(JSON.stringify({ error: "Conversation not found." }), { status: 404, headers });
                    }
                    const msgRes = await rtdbSocialGet(`${DM_MESSAGES_PATH}/${parsed.threadId}/${parsed.messageId}`, accessToken);
                    const msg = msgRes.data;
                    if (!msg || typeof msg !== "object") {
                        return new Response(JSON.stringify({ error: "This message is no longer available." }), { status: 404, headers });
                    }
                    reportContentPath = `kindlechat/dm_messages/${parsed.threadId}/${parsed.messageId}`;
                    reportReportedUserId = msg.uid || "";
                    reportContentSnapshot = String(msg.text || "").substring(0, 2000);
                    dmContext = await getDmReportContext(parsed.threadId, accessToken);
                }
                
                // Rate limit: token bucket (no bypass)
                const rl = await consumeRateLimitToken(uid, "report", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ error: `Rate limit exceeded. You can submit up to ${RATE_LIMIT_CONFIG.report.capacity} reports per hour. Please wait ${rl.retryAfter} second(s).`, retryAfter: rl.retryAfter }), { status: 429, headers });
                }
                
                // Check if another user already reported this content (used for 2-report types)
                const existingReport = await getExistingPendingReport(contentType, contentId, accessToken);
                const isSecondReport = existingReport && existingReport.reporterId !== uid;
                
                // Create report in RTDB (always pending until auto-delete succeeds)
                const reportData = {
                    reporterId: uid,
                    reporterName: username,
                    reportedUserId: reportReportedUserId,
                    reportedUserName: "",
                    contentType,
                    contentId,
                    contentPath: reportContentPath,
                    reason,
                    comment: String(comment || "").trim().substring(0, REPORT_COMMENT_MAX),
                    contentSnapshot: reportContentSnapshot,
                    status: "pending",
                    createdAt: Date.now()
                };
                if (dmContext && dmContext.length) reportData.dmContext = dmContext;
                
                const reportId = await rtdbPushWithAccessToken(REPORTS_PATH, reportData, accessToken);
                reportData.reportId = reportId;
                
                // Decide whether to auto-delete now.
                //
                // Two-report types still need a second, different reporter.
                // Chat/comment/DM types need either a second reporter or a
                // moderation hit on the snapshot: a single report from someone
                // who simply wants the message gone no longer deletes it. A
                // failed moderation call keeps the OLD behaviour (delete), so
                // an OpenAI/network outage cannot leave harassment up.
                let shouldAutoDelete = false;
                let deleteNote = "";
                let heldForReview = false;

                if (TWO_REPORT_DELETE_TYPES.includes(contentType)) {
                    if (isSecondReport) {
                        shouldAutoDelete = true;
                        deleteNote = "Auto-deleted after 2 reports";
                    }
                } else if (isImmediateType) {
                    if (isSecondReport) {
                        shouldAutoDelete = true;
                        deleteNote = "Auto-deleted after 2 reports";
                    } else if (reportContentSnapshot && env.OPENAI_API_KEY) {
                        let moderationChecked = false;
                        let flagged = false;
                        try {
                            const mod = await moderateContent(reportContentSnapshot, env.OPENAI_API_KEY);
                            moderationChecked = !!(mod && typeof mod.flagged === "boolean");
                            flagged = !!(mod && mod.flagged);
                        } catch (modErr) {
                            console.error("[REPORT] Moderation re-check failed:", modErr.message);
                        }
                        if (!moderationChecked || flagged) {
                            // Fail safe: no verdict, or a real violation.
                            shouldAutoDelete = true;
                            deleteNote = flagged
                                ? "Auto-deleted after 1 report (moderation confirmed)"
                                : "Auto-deleted after 1 report (moderation unavailable)";
                        } else {
                            heldForReview = true;
                        }
                    } else {
                        shouldAutoDelete = true;
                        deleteNote = "Auto-deleted after 1 report (moderation unavailable)";
                    }
                }

                if (heldForReview) {
                    // Keep the report pending so the owner can still see it (and
                    // act), but do not remove the content.
                    console.log(`[REPORT] Moderation cleared ${contentType}/${contentId}; holding report ${reportId} for review.`);
                    try {
                        await rtdbUpdateReport(reportId, {
                            resolutionNote: "Held for review (moderation found nothing)"
                        }, accessToken);
                    } catch (e) {
                        console.error("[REPORT] Failed to annotate held report:", e.message);
                    }
                }

                if (shouldAutoDelete) {
                    console.log(`[REPORT] ${isSecondReport ? 'Second' : 'First'} report on ${contentType}/${contentId}. Auto-deleting...`);
                    const deleted = await autoDeleteContent(contentType, contentId, reportContentPath, accessToken);
                    
                    if (deleted) {
                        // Mark reports as resolved only when deletion succeeds
                        try {
                            if (existingReport) {
                                await rtdbUpdateReport(existingReport.reportId, {
                                    status: "resolved",
                                    resolvedAt: Date.now(),
                                    resolvedBy: "system",
                                    resolutionNote: deleteNote
                                }, accessToken);
                            }
                            await rtdbUpdateReport(reportId, {
                                status: "resolved",
                                resolvedAt: Date.now(),
                                resolvedBy: "system",
                                resolutionNote: deleteNote
                            }, accessToken);
                            reportData.status = "resolved";
                            reportData.resolutionNote = deleteNote;
                        } catch (e) {
                            console.error("[REPORT] Failed to update reports after auto-delete:", e.message);
                        }
                    } else {
                        // Deletion failed — keep reports pending so moderators can act
                        reportData.resolutionNote = "Auto-delete failed";
                    }
                }

                // No Discord embed is sent: reports are visible in /reports and
                // the moderation console (notifications removed 2026-10-25).
                return new Response(JSON.stringify({ success: true, id: reportId }), { status: 200, headers });
            }

            return new Response(JSON.stringify({ error: "Unknown content type" }), { status: 400, headers });

        } catch (err) {
            console.error("Moderate Worker Error:", err.message, err.stack);
            return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers });
        }
    }
};

// Exported for scripts/test-chat-spam.js, scripts/test-dm.js,
// scripts/test-reports.js and scripts/test-worker-cors.js (unit tests).
// Wrangler only uses the default export, so these are inert in production.
export {
    corsHeaders,
    chatTextShapes,
    chatTokenOverlap,
    evaluateChatRepetition,
    dmThreadId,
    parseDmMessagePath,
    dmFlagKeyForOrigin,
    isValidDmText,
    dmStatusAfterUnblock,
    reportCommentError,
    hasProperWord
};
