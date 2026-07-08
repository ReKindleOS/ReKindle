/**
 * REKINDLE MODERATE — Cloudflare Worker
 *
 * Server-side content moderation + posting for:
 * - kindlechat messages (RTDB)
 * - topics (Firestore)
 * - topic comments (Firestore)
 * - neighbourhood posts (Firestore)
 * - neighbourhood comments (Firestore)
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
                }
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

async function rtdbPushWithAccessTokenAndReturnKey(path, data, accessToken) {
    const result = await rtdbPushWithAccessToken(path, data, accessToken);
    return result.name;
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
async function autoDeleteContent(contentType, contentId, contentPath, accessToken) {
    try {
        if (contentType === "kindlechat") {
            await rtdbDeleteWithAccessToken(`kindlechat/messages/${contentId}`, accessToken);
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
            await firestoreDelete(contentPath, accessToken);
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
            await firestoreDelete(contentPath, accessToken);
            console.log(`[AUTO-DELETE] Deleted neighbourhood comment ${contentId}`);
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

function containsPromotedTerm(text) {
    if (!text) return false;
    return /\b(?:unreader|un-reader|inkchat|kindlehub)\b/i.test(String(text));
}

async function checkTimeout(uid, env, userToken, accessToken) {
    try {
        const data = await rtdbGetWithUserToken(`timeouts/${uid}`, env, userToken);
        if (data && typeof data.until === "number") {
            const now = Date.now();
            if (data.until > now) {
                const remainingMinutes = Math.ceil((data.until - now) / 60000);
                return { timedOut: true, remainingMinutes };
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
                    return { timedOut: true, remainingMinutes };
                }
            }
        } catch (e2) {
            console.error("[Moderate] Timeout check with access token failed:", e2.message);
        }
    }
    return { timedOut: false };
}

/* ------------------------------------------------------------------ */
/*  FIREBASE TOKEN VERIFICATION                                        */
/* ------------------------------------------------------------------ */
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

    const keysRes = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if (!keysRes.ok) throw new Error("Could not fetch Google public keys: " + keysRes.status);
    const keys = await keysRes.json();

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
/*  LOGGING                                                            */
/* ------------------------------------------------------------------ */
async function logAutomodRejection(uid, contentType, text, categories, accessToken) {
    try {
        const entry = {
            uid,
            contentType,
            text: text.substring(0, 500),
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
    report: { capacity: 5, refillMs: 720000 }         // 12 minutes = 5/hr
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

async function rtdbSocialPutSimple(path, data, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json`;
    const resp = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        console.error("[DEDUPE] Failed to record recent content:", resp.status, errText);
    }
}

async function consumeRateLimitToken(uid, contentType, accessToken) {
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
        bucket.tokens = Math.min(config.capacity, bucket.tokens + refills);
        bucket.lastRefill = bucket.lastRefill + (refills * config.refillMs);

        if (bucket.tokens < 1) {
            const retryAfter = config.refillMs - ((now - bucket.lastRefill) % config.refillMs);
            return { allowed: false, retryAfter: Math.ceil(retryAfter / 1000) };
        }

        bucket.tokens -= 1;
        bucket.updatedAt = now;

        const putResult = await rtdbSocialPut(path, bucket, etag, accessToken);
        if (putResult.ok) {
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
/*  DUPLICATE / REPETITIVE CONTENT DETECTION (per-user, per-type)      */
/* ------------------------------------------------------------------ */
// Stores a normalized hash of recently-submitted text under
// kindlechat/user_recent/{uid}/{contentType}/{hash} -> timestamp.
// Identical or near-identical messages sent within 5 minutes are rejected.
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

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

async function checkUserRecentContent(uid, contentType, text, accessToken) {
    const hash = hashDedupeKey(text);
    if (!hash) return { duplicate: false };
    const path = `kindlechat/user_recent/${uid}/${contentType}/${hash}`;
    const { data } = await rtdbSocialGet(path, accessToken);
    const now = Date.now();
    if (data && typeof data.timestamp === "number" && (now - data.timestamp) < DUPLICATE_WINDOW_MS) {
        return { duplicate: true, retryAfter: Math.ceil((DUPLICATE_WINDOW_MS - (now - data.timestamp)) / 1000) };
    }
    return { duplicate: false };
}

async function recordUserRecentContent(uid, contentType, text, accessToken) {
    const hash = hashDedupeKey(text);
    if (!hash) return;
    const path = `kindlechat/user_recent/${uid}/${contentType}/${hash}`;
    await rtdbSocialPutSimple(path, { timestamp: Date.now() }, accessToken);
}

async function cleanupUserRecentContent(uid, contentType, accessToken) {
    try {
        const path = `kindlechat/user_recent/${uid}/${contentType}`;
        const { data } = await rtdbSocialGet(path, accessToken);
        if (!data || typeof data !== "object") return;
        const now = Date.now();
        const deletes = [];
        for (const [hash, entry] of Object.entries(data)) {
            if (entry && typeof entry.timestamp === "number" && (now - entry.timestamp) > DUPLICATE_WINDOW_MS) {
                deletes.push(rtdbDeleteWithAccessToken(`${path}/${hash}`, accessToken));
            }
        }
        await Promise.all(deletes);
    } catch (e) {
        console.error("[DEDUPE] Cleanup failed:", e.message);
    }
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

/* ------------------------------------------------------------------ */
/*  DISCORD NOTIFICATIONS                                              */
/* ------------------------------------------------------------------ */
async function sendDiscordReportNotification(env, reportData) {
    const botToken = env.DISCORD_BOT_TOKEN;
    const channelId = env.DISCORD_CHANNEL_ID;
    
    if (!botToken || !channelId) {
        console.log("[REPORT] DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not configured, skipping notification");
        return;
    }
    
    const truncatedSnapshot = reportData.contentSnapshot
        ? reportData.contentSnapshot.substring(0, 500).replace(/```/g, "` ` `") + (reportData.contentSnapshot.length > 500 ? "..." : "")
        : "No preview available";
    
    const isAutoDeleted = reportData.autoDeleted === true;
    const title = isAutoDeleted
        ? (reportData.deleteSuccess ? "AUTO-DELETED: Content Removed" : "AUTO-DELETE FAILED")
        : "New Content Report";
    const color = isAutoDeleted
        ? (reportData.deleteSuccess ? 3066993 : 15158332)
        : 15158332;
    
    const fields = [
        { name: "Reporter", value: `${reportData.reporterName} (${reportData.reporterId})`, inline: true },
        { name: "Reported User", value: `${reportData.reportedUserName || "Unknown"} (${reportData.reportedUserId})`, inline: true },
        { name: "Content Type", value: reportData.contentType, inline: true },
        { name: "Reason", value: reportData.reason, inline: true }
    ];
    
    if (isAutoDeleted) {
        fields.push({ name: "Auto-Delete", value: reportData.deleteSuccess ? (reportData.resolutionNote || "Content was automatically deleted") : "Auto-delete failed, manual action required", inline: false });
    }
    
    fields.push(
        { name: "Content ID", value: reportData.contentId, inline: false },
        { name: "Content Path", value: reportData.contentPath, inline: false },
        { name: "Comment", value: reportData.comment || "None", inline: false },
        { name: "Content Preview", value: "```\n" + truncatedSnapshot + "\n```", inline: false }
    );
    
    const embed = {
        title,
        color,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "ReKindle Moderation" }
    };
    
    const payload = { embeds: [embed] };
    
    // Add action buttons (only for non-auto-deleted content)
    if (!isAutoDeleted) {
        const actionId = `${reportData.contentType}:${reportData.contentId}:${reportData.reportedUserId || ""}`;
        payload.components = [{
            type: 1,
            components: [
                {
                    type: 2,
                    style: 4,
                    label: "Delete Content",
                    custom_id: `delete:${actionId}`,
                    emoji: { name: "🗑️" }
                },
                {
                    type: 2,
                    style: 3,
                    label: "Timeout User (24h)",
                    custom_id: `timeout:${actionId}`,
                    emoji: { name: "⏰" }
                },
                {
                    type: 2,
                    style: 2,
                    label: "Dismiss Report",
                    custom_id: `dismiss:${actionId}`,
                    emoji: { name: "✅" }
                }
            ]
        }];
    }
    
    try {
        const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
                "Authorization": `Bot ${botToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const errText = await resp.text();
            console.error("[REPORT] Discord bot notification failed:", resp.status, errText);
        }
    } catch (e) {
        console.error("[REPORT] Discord notification failed:", e.message);
    }
}

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
                const contentPath = getContentPath(contentType, contentId);
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
    if (contentType === "topic_comment") return `topics/${contentId}`;
    if (contentType === "neighbourhood_post") return `neighbourhood_posts/${contentId}`;
    if (contentType === "neighbourhood_comment") return `neighbourhood_posts/${contentId}`;
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
            return new Response(null, { headers });
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

            // --- TIMEOUT CHECK (skip for reports) ---
            if (type !== "report") {
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

                // Rate limit
                const rl = await consumeRateLimitToken(uid, "kindlechat", accessToken);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ allowed: false, error: `Rate limit exceeded. Please wait ${rl.retryAfter} second(s) before posting.`, retryAfter: rl.retryAfter }), { status: 429, headers });
                }

                // Duplicate / repetitive content detection
                const dupCheck = await checkUserRecentContent(uid, "kindlechat", trimmed, accessToken);
                if (dupCheck.duplicate) {
                    return new Response(JSON.stringify({ allowed: false, error: "You already sent this recently. Please wait a few minutes.", retryAfter: dupCheck.retryAfter }), { status: 429, headers });
                }

                const isFlipnote = body.is_flipnote === true;
                const isPixelArt = body.is_pixel_art === true;
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

                console.log("[WORKER] kindlechat post — token claims:", { email: payload.email, ageVerified: payload.ageVerified, moderator: payload.moderator, aud: payload.aud });
                const result = await rtdbPushWithAccessToken("kindlechat/messages", msgData, accessToken);

                // Record this text for duplicate detection (non-blocking)
                if (trimmed) {
                    recordUserRecentContent(uid, "kindlechat", trimmed, accessToken).catch(e => console.error("[DEDUPE] record failed:", e.message));
                    cleanupUserRecentContent(uid, "kindlechat", accessToken).catch(e => console.error("[DEDUPE] cleanup failed:", e.message));
                }

                return new Response(JSON.stringify({ allowed: true, key: result.name }), { status: 200, headers });
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

                // Duplicate / repetitive content detection
                const dupCheck = await checkUserRecentContent(uid, "topic", title + " " + subheading, accessToken);
                if (dupCheck.duplicate) {
                    return new Response(JSON.stringify({ error: "You already posted a topic like this recently. Please wait a few minutes.", retryAfter: dupCheck.retryAfter }), { status: 429, headers });
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

                // Duplicate / repetitive content detection
                const dupCheck = await checkUserRecentContent(uid, "topic_comment", commentText, accessToken);
                if (dupCheck.duplicate) {
                    return new Response(JSON.stringify({ error: "You already sent this comment recently. Please wait a few minutes.", retryAfter: dupCheck.retryAfter }), { status: 429, headers });
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

                // Duplicate / repetitive content detection
                const dupCheck = await checkUserRecentContent(uid, "neighbourhood_post", trimmed, accessToken);
                if (dupCheck.duplicate) {
                    return new Response(JSON.stringify({ error: "You already posted this recently. Please wait a few minutes.", retryAfter: dupCheck.retryAfter }), { status: 429, headers });
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

                // Duplicate / repetitive content detection
                const dupCheck = await checkUserRecentContent(uid, "neighbourhood_comment", trimmed, accessToken);
                if (dupCheck.duplicate) {
                    return new Response(JSON.stringify({ error: "You already sent this comment recently. Please wait a few minutes.", retryAfter: dupCheck.retryAfter }), { status: 429, headers });
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

                return new Response(JSON.stringify({ success: true, id }), { status: 200, headers });
            }

            // --- REPORT ---
            if (type === "report") {
                const { contentType, contentId, contentPath, reportedUserId, reason, comment, contentSnapshot } = body;
                
                if (!contentType || !contentId || !reason) {
                    return new Response(JSON.stringify({ error: "Missing required report fields." }), { status: 400, headers });
                }
                
                const validContentTypes = ["kindlechat", "topic", "topic_comment", "neighbourhood_post", "neighbourhood_comment"];
                if (!validContentTypes.includes(contentType)) {
                    return new Response(JSON.stringify({ error: "Invalid content type." }), { status: 400, headers });
                }
                
                // Content removed on the first report
                const IMMEDIATE_DELETE_TYPES = ["kindlechat", "topic_comment", "neighbourhood_comment"];
                // Content that requires two reports from different users
                const TWO_REPORT_DELETE_TYPES = ["topic", "neighbourhood_post"];
                const shouldDeleteImmediately = IMMEDIATE_DELETE_TYPES.includes(contentType);
                
                // Validate lengths
                if (comment && comment.length > 500) {
                    return new Response(JSON.stringify({ error: "Comment is too long (max 500 characters)." }), { status: 400, headers });
                }
                if (contentSnapshot && contentSnapshot.length > 2000) {
                    return new Response(JSON.stringify({ error: "Content snapshot is too long (max 2000 characters)." }), { status: 400, headers });
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
                    reportedUserId: reportedUserId || "",
                    reportedUserName: "",
                    contentType,
                    contentId,
                    contentPath: contentPath || "",
                    reason,
                    comment: (comment || "").substring(0, 500),
                    contentSnapshot: (contentSnapshot || "").substring(0, 2000),
                    status: "pending",
                    createdAt: Date.now()
                };
                
                const reportId = await rtdbPushWithAccessToken(REPORTS_PATH, reportData, accessToken);
                reportData.reportId = reportId;
                
                // Decide whether to auto-delete now
                let shouldAutoDelete = false;
                let deleteNote = "";
                if (shouldDeleteImmediately) {
                    shouldAutoDelete = true;
                    deleteNote = "Auto-deleted after 1 report";
                } else if (TWO_REPORT_DELETE_TYPES.includes(contentType) && isSecondReport) {
                    shouldAutoDelete = true;
                    deleteNote = "Auto-deleted after 2 reports";
                }
                
                if (shouldAutoDelete) {
                    console.log(`[REPORT] ${shouldDeleteImmediately ? 'Immediate' : 'Second'} report on ${contentType}/${contentId}. Auto-deleting...`);
                    const deleted = await autoDeleteContent(contentType, contentId, contentPath, accessToken);
                    
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
                    
                    // Send Discord notification about auto-deletion
                    await sendDiscordReportNotification(env, {
                        ...reportData,
                        autoDeleted: true,
                        deleteSuccess: deleted
                    });
                } else {
                    // Send normal Discord notification for first report
                    await sendDiscordReportNotification(env, reportData);
                }
                
                return new Response(JSON.stringify({ success: true, id: reportId }), { status: 200, headers });
            }

            return new Response(JSON.stringify({ error: "Unknown content type" }), { status: 400, headers });

        } catch (err) {
            console.error("Moderate Worker Error:", err.message, err.stack);
            return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers });
        }
    }
};
