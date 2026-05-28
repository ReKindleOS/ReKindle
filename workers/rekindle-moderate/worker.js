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
/*  OPENAI MODERATION                                                  */
/* ------------------------------------------------------------------ */
const moderationCache = new Map(); // text -> { result, expiry }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function moderateContent(text, apiKey, imageUrl) {
    if (!apiKey) throw new Error("OpenAI API key not configured");
    if (!text && !imageUrl) return { flagged: false, categories: {} };

    // Check cache (text-only)
    if (!imageUrl && text && typeof text === "string") {
        const cached = moderationCache.get(text);
        if (cached && cached.expiry > Date.now()) {
            return cached.result;
        }
    }

    let requestBody;
    if (imageUrl) {
        const input = [{ type: "image_url", image_url: { url: imageUrl } }];
        if (text) {
            input.unshift({ type: "text", text: text });
        }
        requestBody = {
            model: "omni-moderation-latest",
            input: input
        };
        console.log("[MODERATION] Sending image to OpenAI. Image URL length:", imageUrl.length, "hasText:", !!text, "categories with image support: sexual, violence, violence/graphic, self-harm, self-harm/intent, self-harm/instructions");
    } else {
        requestBody = {
            model: "omni-moderation-latest",
            input: text
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

    // Store in cache (text-only)
    if (!imageUrl && text && typeof text === "string") {
        moderationCache.set(text, { result: moderationResult, expiry: Date.now() + CACHE_TTL_MS });
    }

    return moderationResult;
}

/* ------------------------------------------------------------------ */
/*  PIXEL ART MODERATION HELPERS                                       */
/* ------------------------------------------------------------------ */

// Infer grid size from grid_data so we can tune thresholds per canvas size
function getGridSize(gridDataStr) {
    try {
        const grid = JSON.parse(gridDataStr);
        if (Array.isArray(grid) && grid.length > 0) {
            return grid.length;
        }
    } catch (e) { }
    return null;
}

// Thresholds tuned against a 32x32 test set (smiley, plane, penis, swastika).
// The penis is caught by the low sexual threshold.
// Hate thresholds are set low to catch swastikas if the model ever returns
// a non-zero hate score for them.
// A heuristic is also used for swastikas because the model currently returns
// hate=0 for 32x32 pixel art swastikas.
function getPixelArtThresholds(gridSize) {
    if (gridSize === 32) {
        return {
            sexual: 0.000055,           // penis scored 0.000088; benign scored ~0.000040
            violence: 0.008,
            "violence/graphic": 0.008,
            "self-harm": 0.008,
            "self-harm/intent": 0.008,
            "self-harm/instructions": 0.008,
            hate: 0.000010,
            "hate/threatening": 0.000010
        };
    }

    // Fallback for 16x16 or anything else
    return {
        sexual: 0.004,
        violence: 0.004,
        "violence/graphic": 0.004,
        "self-harm": 0.004,
        "self-harm/intent": 0.004,
        "self-harm/instructions": 0.004,
        hate: 0.004,
        "hate/threatening": 0.004
    };
}

function checkPixelArtScores(mod, isPixelArt, gridSize) {
    if (!isPixelArt || mod.flagged) return mod;

    const thresholds = getPixelArtThresholds(gridSize);
    const flaggedCategories = {};
    let anyFlagged = false;

    for (const [category, threshold] of Object.entries(thresholds)) {
        const score = mod.categoryScores[category] || 0;
        if (score >= threshold) {
            flaggedCategories[category] = true;
            anyFlagged = true;
        }
    }

    // Experimental heuristic for 32x32 hate symbols (e.g. swastika).
    // The model often returns near-zero hate scores for small pixel art,
    // but hate symbols tend to have moderate violence with very low
    // self-harm/intent compared to benign curved shapes.
    // Test data: swastika violence=0.000510, self-harm/intent=0.000005.
    if (gridSize === 32 && !anyFlagged) {
        const violenceScore = mod.categoryScores["violence"] || 0;
        const selfHarmIntentScore = mod.categoryScores["self-harm/intent"] || 0;
        if (violenceScore >= 0.000500 && selfHarmIntentScore <= 0.000050) {
            flaggedCategories["hate"] = true;
            anyFlagged = true;
            console.log("[MODERATION] Pixel art flagged by 32x32 hate-symbol heuristic:", JSON.stringify(flaggedCategories));
        }
    }

    if (anyFlagged) {
        console.log("[MODERATION] Pixel art flagged by custom thresholds (gridSize:", gridSize, "):", JSON.stringify(flaggedCategories));
        return {
            ...mod,
            flagged: true,
            categories: { ...mod.categories, ...flaggedCategories }
        };
    }

    return mod;
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
/*  RATE LIMITING (in-memory, per-isolate)                             */
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
/*  MAIN HANDLER                                                       */
/* ------------------------------------------------------------------ */
export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        const headers = corsHeaders(origin);
        const url = new URL(request.url);

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

            // --- TIMEOUT CHECK ---
            const timeoutCheck = await checkTimeout(uid, env, token, accessToken);
            if (timeoutCheck.timedOut) {
                return new Response(JSON.stringify({
                    error: `You are timed out. Please wait ${timeoutCheck.remainingMinutes} minute(s) before posting.`
                }), { status: 403, headers });
            }

            // --- KINDLECHAT ---
            if (type === "kindlechat") {
                const trimmed = String(text).substring(0, 1000);
                const hasFlipnote = body.flipnote_data && typeof body.flipnote_data === "object";
                const hasPixelArt = body.pixel_art && typeof body.pixel_art === "string";
                if (!trimmed && !hasFlipnote && !hasPixelArt) {
                    return new Response(JSON.stringify({ error: "Empty message" }), { status: 400, headers });
                }

                // Rate limit
                const rl = checkRateLimit(`chat:${username}`, 15, 20000);
                if (!rl.allowed) {
                    return new Response(JSON.stringify({ allowed: false, retryAfter: rl.retryAfter }), { status: 429, headers });
                }

                // Moderation
                const mod = await moderateContent(trimmed, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "kindlechat", trimmed, mod.categories, accessToken);
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const msgData = {
                    uid,
                    timestamp: { ".sv": "timestamp" },
                    text: trimmed
                };
                // Allow known extra fields from client
                const allowedExtras = ["pixel_art", "grid_data", "is_pixel_art", "is_flipnote", "flipnote_data"];
                for (const key of allowedExtras) {
                    if (key in body) msgData[key] = body[key];
                }

                // Flipbook bypasses moderation (animation data, not images)
                const isFlipnote = body.is_flipnote === true;
                // Pixel art sends image for moderation
                const pixelArt = body.pixel_art || null;
                const gridSize = getGridSize(body.grid_data);
                console.log("[WORKER] kindlechat request — isFlipnote:", isFlipnote, "hasPixelArt:", !!pixelArt, "pixelArtLength:", pixelArt ? pixelArt.length : 0, "pixelArtIsBase64:", pixelArt ? pixelArt.startsWith("data:image") : false, "gridSize:", gridSize);

                if (gridSize === 64) {
                    return new Response(JSON.stringify({ error: "64× pixel art is not supported in chat." }), { status: 400, headers });
                }

                if (!isFlipnote) {
                    // Send pixel art images without text so image-category scores aren't
                    // diluted by innocent text context.
                    const isPixelArt = body.is_pixel_art === true;
                    const imageText = isPixelArt ? null : trimmed;
                    let mod = await moderateContent(imageText, env.OPENAI_API_KEY, pixelArt);
                    mod = checkPixelArtScores(mod, isPixelArt, gridSize);
                    if (mod.flagged) {
                        await logAutomodRejection(uid, "kindlechat", trimmed, mod.categories, accessToken);
                        return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                    }
                }

                console.log("[WORKER] kindlechat post — token claims:", { email: payload.email, ageVerified: payload.ageVerified, moderator: payload.moderator, aud: payload.aud });
                const result = await rtdbPushWithAccessToken("kindlechat/messages", msgData, accessToken);
                return new Response(JSON.stringify({ allowed: true, key: result.name }), { status: 200, headers });
            }

            // --- TOPIC ---
            if (type === "topic") {
                const title = (body.title || "").trim();
                const subheading = (body.subheading || "").trim();
                const icon = body.icon;

                if (!title || title.length > 20) {
                    return new Response(JSON.stringify({ error: "Title must be 1-20 characters." }), { status: 400, headers });
                }
                if (subheading.length > 35) {
                    return new Response(JSON.stringify({ error: "Subheading must be 0-35 characters." }), { status: 400, headers });
                }
                if (!icon || typeof icon !== "string") {
                    return new Response(JSON.stringify({ error: "Icon is required." }), { status: 400, headers });
                }

                // Rate limit: 1 topic per day
                if (!isAdmin) {
                    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                    const queryResp = await fetch(`https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents:runQuery`, {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                            structuredQuery: {
                                from: [{ collectionId: "topics" }],
                                where: {
                                    compositeFilter: {
                                        op: "AND",
                                        filters: [
                                            { fieldFilter: { field: { fieldPath: "authorId" }, op: "EQUAL", value: { stringValue: uid } } },
                                            { fieldFilter: { field: { fieldPath: "timestamp" }, op: "GREATER_THAN", value: { timestampValue: oneDayAgo } } }
                                        ]
                                    }
                                },
                                limit: 1
                            }
                        })
                    });
                    const queryData = await queryResp.json();
                    const hasRecent = Array.isArray(queryData) && queryData.some(d => d.document);
                    if (hasRecent) {
                        return new Response(JSON.stringify({ error: "You are limited to creating 1 topic per day." }), { status: 429, headers });
                    }
                }

                // Moderation
                const textToModerate = title + " " + subheading;
                const mod = await moderateContent(textToModerate, env.OPENAI_API_KEY);
                if (mod.flagged) {
                    await logAutomodRejection(uid, "topic", textToModerate, mod.categories, accessToken);
                    return new Response(JSON.stringify({ error: moderationErrorMessage(mod) }), { status: 400, headers });
                }

                const id = await firestoreCreate("topics", {
                    title,
                    subheading,
                    body: "",
                    icon,
                    authorId: uid,
                    timestamp: new Date(),
                    lastActive: new Date(),
                    commentCount: 0
                }, accessToken);

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

                const commentText = rawBody.replace(/(\n\s*){3,}/g, "\n\n").trim();

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

                // Update topic counters
                let newCount = 0;
                try {
                    const topicResp = await fetch(`https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/topics/${topicId}`, {
                        headers: { "Authorization": `Bearer ${accessToken}` }
                    });
                    if (topicResp.ok) {
                        const topicDoc = await topicResp.json();
                        const countField = topicDoc.fields?.commentCount;
                        newCount = countField ? (countField.integerValue ? parseInt(countField.integerValue) : countField.doubleValue || 0) : 0;
                        newCount += 1;
                    }
                } catch (e) {
                    console.error("Error fetching topic count:", e);
                }

                await firestorePatch(`topics/${topicId}`, {
                    commentCount: newCount || 1,
                    lastActive: new Date()
                }, accessToken);

                return new Response(JSON.stringify({ success: true, id: commentId, commentCount: newCount || 1 }), { status: 200, headers });
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

            return new Response(JSON.stringify({ error: "Unknown content type" }), { status: 400, headers });

        } catch (err) {
            console.error("Moderate Worker Error:", err.message, err.stack);
            return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers });
        }
    }
};
