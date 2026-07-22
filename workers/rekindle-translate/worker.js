/**
 * REKINDLE CHAT - TRANSLATION WORKER
 * Deployed to Cloudflare Workers
 * 
 * Functionality:
 * 1. Receives chat message payload via POST
 * 2. Checks if message is an ASCII emoji (skips translation if so)
 * 3. Translates text to all supported languages using Google Translate
 * 4. Writes translations to Firebase RTDB or Firestore using service account auth
 */

/* ------------------------------------------------------------------ */
/*  SERVICE ACCOUNT AUTH (copied from rekindle-moderate worker)       */
/* ------------------------------------------------------------------ */
let cachedAccessToken = null;
let cachedTokenExpiry = 0;

function resolveServiceAccount(env) {
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
    let normalizedPem = privateKeyPEM.replace(/\\n/g, "\n");
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
/*  FIREBASE TOKEN VERIFICATION (copied from rekindle-moderate)       */
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
/*  FIRESTORE HELPERS                                                  */
/* ------------------------------------------------------------------ */
function toFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
    if (typeof value === 'object') {
        const fields = {};
        for (const [k, v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
        return { mapValue: { fields } };
    }
    return { stringValue: String(value) };
}

async function firestorePatch(docPath, data, accessToken) {
    const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/${docPath}?${mask}`;
    const fields = {};
    for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreValue(value);
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ fields })
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Firestore patch failed (${resp.status}): ${errText}`);
    }
}

async function firestoreCreate(collectionPath, data, accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/rekindle-socials/databases/(default)/documents/${collectionPath}`;
    const fields = {};
    for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreValue(value);
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ fields })
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Firestore create failed (${resp.status}): ${errText}`);
    }
    const json = await resp.json();
    const parts = (json.name || '').split('/');
    return parts[parts.length - 1];
}

/* ------------------------------------------------------------------ */
/*  RTDB HELPERS                                                       */
/* ------------------------------------------------------------------ */
async function rtdbPushWithAccessToken(path, data, accessToken) {
    const url = `https://rekindle-socials-default-rtdb.firebaseio.com/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`RTDB push failed (${resp.status}): ${errText}`);
    }
    return await resp.json();
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
}

/* ------------------------------------------------------------------ */
/*  EMOJI & TRANSLATION LOGIC                                          */
/* ------------------------------------------------------------------ */
const ASCII_EMOJIS = {
    "ʘ‿ʘ": [
        { art: "\\˚ㄥ˚\\", name: "Quirky" },
        { art: "☁ ▅▒░☼‿☼░▒▅ ☁", name: "Sunrise" },
        { art: "ˁ˚ᴥ˚ˀ", name: "Bear Friend" },
        { art: "⎦˚◡˚⎣", name: "Boxy Smile" },
        { art: "<*_*>", name: "Starry Eyes" },
        { art: "(-(-_(-_-)_-)-)", name: "The Squad" },
        { art: "(✿ ♥‿♥)", name: "Lovely" },
        { art: "㋡", name: "Chill" },
        { art: "(⌒▽⌒)", name: "Joy" },
        { art: "(◔/‿\\◔)", name: "Derp Stare" },
        { art: "(⋗_⋖)", name: "Ouch" },
        { art: "ة_ة", name: "Dazed" },
        { art: "\\(^-^)/", name: "Yay" },
        { art: "◕_◕", name: "Puppy Eyes" },
        { art: "(っ◕‿◕)っ", name: "Gimme Hug" },
        { art: "( ͠° ͟ʖ ͡°)", name: "Suspicious" },
        { art: "ʘ‿ʘ", name: "Innocent Face" },
        { art: "(｡◕‿◕｡)", name: "Cute Big Eyes" },
        { art: "☜(⌒▽⌒)☞", name: "Excited" },
        { art: "ヽ(´▽`)/", name: "Happy" },
        { art: "ヽ(´ー｀)ノ", name: "Glory" },
        { art: "⊂(◉‿◉)つ", name: "Kirby" },
        { art: "(づ￣ ³￣)づ", name: "Hugger" },
        { art: "“ヽ(´▽｀)ノ”", name: "TGIF" },
        { art: "♥‿♥", name: "Love" },
        { art: "( ˘ ³˘)♥", name: "Kissing" },
        { art: "\\(ᵔᵕᵔ)/", name: "Happy Hug" },
        { art: "ᴖ̮ ̮ᴖ", name: "Resting Eyes" },
        { art: "-`ღ´-", name: "Love 2" }
    ],
    "ಠ_ಠ": [
        { art: "ಠ_ಠ", name: "Disapproval" },
        { art: "(╬ ಠ益ಠ)", name: "Angry" },
        { art: "ლ(ಠ益ಠლ)", name: "At What Cost" },
        { art: "ಠ‿ಠ", name: "Devious" },
        { art: "ಥ_ಥ", name: "Crying" },
        { art: "ಥ﹏ಥ", name: "Breakdown" },
        { art: "٩◔̯◔۶", name: "Disagree" },
        { art: "(´･_･`)", name: "Worried" },
        { art: "(ಥ⌣ಥ)", name: "Sad" },
        { art: "눈_눈", name: "Sleepy" },
        { art: "( ఠ ͟ʖ ఠ)", name: "Judging" },
        { art: "( ͡ಠ ʖ̯ ͡ಠ)", name: "Tired" },
        { art: "( ಠ ʖ̯ ಠ)", name: "Dislike" },
        { art: "(ᵟຶ︵ ᵟຶ)", name: "Sad Crying" }
    ],
    "(っ▀¯▀)つ": [
        { art: "¯\\_(ツ)_/¯", name: "Shrug" },
        { art: "( ͡° ͜ʖ ͡°)", name: "Lenny Face" },
        { art: "ᕙ(⇀‸↼‶)ᕗ", name: "Flexing" },
        { art: "┌(ㆆ㉨ㆆ)ʃ", name: "Dancing" },
        { art: "(•̀ᴗ•́)و ̑̑", name: "Winning" },
        { art: "(☞ﾟヮﾟ)☞", name: "Pointing" },
        { art: "(っ▀¯▀)つ", name: "Stunna Shades" },
        { art: "(∩｀-´)⊃━☆ﾟ.*･｡ﾟ", name: "Wizard" },
        { art: "(╯°□°）╯︵ ┻━┻", name: "Table Flip" },
        { art: "┬─┬﻿ ノ( ゜-゜ノ)", name: "Put Table Back" },
        { art: "┬─┬⃰͡ (ᵔᵕᵔ͜ )", name: "Tidy Table" },
        { art: "(ง'̀-'́)ง", name: "Fight" }
    ],
    "ʕ•ᴥ•ʔ": [
        { art: "ʕ•ᴥ•ʔ", name: "Cute Bear" },
        { art: "ʕᵔᴥᵔʔ", name: "Squinting Bear" },
        { art: "ʕ •`ᴥ•´ʔ", name: "GTFO Bear" },
        { art: "V•ᴥ•V", name: "Dog" },
        { art: "ฅ^•ﻌ•^ฅ", name: "Meow" },
        { art: "ʕ •́؈•̀ ₎", name: "Winnie" },
        { art: "{•̃_•̃}", name: "Robot" },
        { art: "(ᵔᴥᵔ)", name: "Seal" },
        { art: "[¬º-°]¬", name: "Zombie" },
        { art: "ƪ(ړײ)‎ƪ​​", name: "Creeper" }
    ],
    "⊙﹏⊙": [
        { art: "¯\\(°_o)/¯", name: "Meh" },
        { art: "⊙﹏⊙", name: "Discombobulated" },
        { art: "¯\\_(⊙︿⊙)_/¯", name: "Sad Confused" },
        { art: "¿ⓧ_ⓧﮌ", name: "Confused" },
        { art: "(⊙.☉)7", name: "Confused Scratch" },
        { art: "٩(๏_๏)۶", name: "Staring" },
        { art: "(⊙_◎)", name: "Zoned" },
        { art: "ミ●﹏☉ミ", name: "Crazy" },
        { art: "(Ծ‸ Ծ)", name: "Questionable" },
        { art: "⥀.⥀", name: "Eye Roll" },
        { art: "♨_♨", name: "Unseen" },
        { art: "(._.)", name: "Looking Down" }
    ]
};

const KNOWN_EMOJI_SET = new Set();
Object.values(ASCII_EMOJIS).forEach(list => {
    list.forEach(item => KNOWN_EMOJI_SET.add(item.art));
});

function isAsciiEmoji(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (KNOWN_EMOJI_SET.has(trimmed)) return true;
    const letterMatch = trimmed.match(/[\p{L}\p{N}]/gu);
    const letters = letterMatch ? letterMatch.length : 0;
    const symbols = trimmed.length - letters;
    if (trimmed.length < 15 && symbols > letters) return true;
    if (/^[()0-9^>.<_ \-*\\/|]+$/.test(trimmed)) return true;
    return false;
}

async function translateWithGoogle(text, targetLang = 'en', sourceLang = 'auto', client = 'gtx') {
    if (!text || text.trim().length === 0 || isAsciiEmoji(text)) {
        return { text: null, error: "Skipped: Emoji or Empty" };
    }
    if (sourceLang === targetLang) {
        return { text: null, error: `Skipped: Source language is same as target (${targetLang})` };
    }
    const mentions = [];
    const maskedText = text.replace(/@(\w+)/g, (match) => {
        mentions.push(match);
        return `__MENTION_${mentions.length - 1}__`;
    });
    const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(maskedText)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(url);
            // Retry once on rate-limit / server errors (shared cloud egress IPs get 429s)
            if (response.status === 429 || response.status >= 500) {
                if (attempt === 0) {
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }
                throw new Error(`Google API Error: ${response.status}`);
            }
            if (!response.ok) {
                throw new Error(`Google API Error: ${response.status} ${await response.text()}`);
            }
            const data = await response.json();
            if (!data || !data[0]) {
                throw new Error("Invalid response format from Google");
            }
            let translatedText = data[0].map(chunk => chunk[0]).join('');
            const detectedLang = data[2];
            mentions.forEach((mention, index) => {
                translatedText = translatedText.replace(`__MENTION_${index}__`, mention);
            });
            if (detectedLang === targetLang) {
                return { text: null, error: `Skipped: Detected language is same as target (${targetLang})` };
            }
            if (translatedText && translatedText.toLowerCase().trim() !== text.toLowerCase().trim()) {
                return { text: translatedText, error: null };
            }
            return { text: null, error: "Suppressed: Identical translation" };
        } catch (err) {
            if (attempt === 0 && /429|5\d\d|fetch|network/i.test(err.message)) {
                await new Promise(r => setTimeout(r, 400));
                continue;
            }
            console.error(`Translation to ${targetLang} failed (client=${client}):`, err);
            return { text: null, error: `Failed: ${err.message}` };
        }
    }
    return { text: null, error: "Failed: exhausted retries" };
}

async function detectLanguageInfo(text) {
    if (!text || text.trim().length === 0) {
        return { detectedLang: 'en', confidence: 1, translatedToEn: text };
    }
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return { detectedLang: 'en', confidence: 1, translatedToEn: text };
        }
        const data = await response.json();
        const detectedLang = data[2] || 'en';
        const confidence = typeof data[6] === 'number' ? data[6] : 0;
        let translatedToEn = '';
        if (data && data[0]) {
            translatedToEn = data[0].map(chunk => chunk[0]).join('');
        }
        return { detectedLang, confidence, translatedToEn };
    } catch (err) {
        console.error('Language detection failed:', err);
        return { detectedLang: 'en', confidence: 1, translatedToEn: text };
    }
}

function isProbablyEnglish(original, detectedLang, confidence, translatedToEn) {
    // If Google says it's English, it is
    if (detectedLang === 'en') return true;

    // If Google is very confident it's NOT English, trust it
    if (confidence >= 0.85) return false;

    // Normalize for comparison (strip punctuation and case)
    const normOrig = original.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normTrans = (translatedToEn || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normOrig.length > 0 && normTrans.length > 0) {
        // If identical after stripping punctuation, it was English
        if (normOrig === normTrans) return true;

        // If one contains the other and text is short, probably English
        const longer = Math.max(normOrig.length, normTrans.length);
        const contained = normOrig.includes(normTrans) || normTrans.includes(normOrig);
        if (contained && longer < 30) return true;
    }

    // Non-English detection below the 0.85 trust threshold with mostly
    // Latin/ASCII characters is a strong signal for English text-speak /
    // funny spellings (covers the 0.75-0.85 mid-confidence window too)
    if (confidence < 0.85 && original.length > 0) {
        const latinChars = (original.match(/[a-zA-Z\s0-9.,!?;:'"-]/g) || []).length;
        if (latinChars / original.length > 0.85) return true;
    }

    return false;
}

function resolveSourceLang(text, detectedLang, confidence, translatedToEn) {
    if (isProbablyEnglish(text, detectedLang, confidence, translatedToEn)) return 'en';
    return detectedLang || 'en';
}

async function translateToAllLanguages(text) {
    if (!text || text.trim().length === 0 || isAsciiEmoji(text)) return null;

    // One Google call doubles as the language detector AND the English
    // translation (sl=auto&tl=en returns detected lang, confidence, and the
    // English text), so non-English sources cost 9 calls total, not 10-11.
    const { detectedLang, confidence, translatedToEn } = await detectLanguageInfo(text);
    const sourceLang = resolveSourceLang(text, detectedLang, confidence, translatedToEn);

    const targetLangs = ['en', 'es', 'pt', 'pl', 'de', 'it', 'fr', 'ru', 'zh', 'vi'];
    const translations = {};

    // Identity entry: readers whose language matches the source always see
    // the original text, never a machine "translation" of it.
    if (sourceLang === 'en') {
        translations.en = text;
    } else if (translatedToEn && translatedToEn.toLowerCase().trim() !== text.toLowerCase().trim()) {
        translations.en = translatedToEn; // reuse the detect call's English output
    }
    if (targetLangs.indexOf(sourceLang) !== -1) {
        translations[sourceLang] = text;
    }

    const remaining = targetLangs.filter(l => l !== 'en' && l !== sourceLang);
    // Sequential with a small stagger: Google's gtx endpoint 429s parallel
    // bursts from shared Cloudflare egress IPs (verified 2026-07 — a
    // Promise.all fan-out got every target call rate-limited while the
    // identity entry still wrote, producing en-only coverage).
    for (const lang of remaining) {
        const result = await translateWithGoogle(text, lang, sourceLang);
        if (result.text) translations[lang] = result.text;
        await new Promise(r => setTimeout(r, 75));
    }

    return Object.keys(translations).length > 0 ? translations : null;
}

async function writeTranslationsByLang(translations, msgId, accessToken) {
    if (!translations || !msgId) return;
    const baseUrl = "https://rekindle-socials-default-rtdb.firebaseio.com/kindlechat/translations_by_lang";
    const promises = [];
    const langEntries = [];
    for (const [lang, text] of Object.entries(translations)) {
        const url = `${baseUrl}/${lang}/${msgId}.json?access_token=${encodeURIComponent(accessToken)}`;
        promises.push(
            fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(text)
            })
        );
        langEntries.push(lang);
    }
    const results = await Promise.all(promises);
    for (let i = 0; i < results.length; i++) {
        if (!results[i].ok) {
            const errText = await results[i].text();
            throw new Error(`Firebase translation write failed for ${langEntries[i]} (${results[i].status}): ${errText}`);
        }
    }
}

/* ------------------------------------------------------------------ */
/*  MAIN HANDLER                                                       */
/* ------------------------------------------------------------------ */
export default {
    async fetch(request, env) {
        const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "127.0.0.1";

        const allowedOrigins = [
            "https://beta.rekindle.ink",
            "https://rekindle.ink",
            "https://lite.rekindle.ink",
            "https://legacy.rekindle.ink",
        ];
        const origin = request.headers.get("Origin");
        const isAllowed = allowedOrigins.indexOf(origin) !== -1;

        const headers = {
            'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[1],
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': 'application/json'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers });
        }

        if (!isAllowed && origin !== null) {
            return new Response(JSON.stringify({ error: "Forbidden: Origin not allowed" }), { status: 403, headers });
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405, headers });
        }

        const authHeader = request.headers.get('Authorization');
        const userToken = authHeader ? authHeader.split(' ')[1] : null;

        try {
            // Verify caller is authenticated (same as moderation worker)
            if (!userToken) {
                return new Response(JSON.stringify({ error: "Missing authorization token" }), { status: 401, headers });
            }
            await verifyFirebaseToken(userToken, env);

            // Use service account for all Firebase writes (fixes permission issues)
            const accessToken = await getCachedAccessToken(env);

            const payload = await request.json();
            const { user, uid, text, msgId, reprocess, translateOnly, app } = payload;

            console.log("Worker received payload:", JSON.stringify(payload));

            let baseFirebaseUrl = "https://rekindle-socials-default-rtdb.firebaseio.com/kindlechat/messages";
            if (app === 'neighbourhood') {
                baseFirebaseUrl = "https://rekindle-socials-default-rtdb.firebaseio.com/neighbourhood_posts";
            }

            if (translateOnly && msgId) {
                const translatedText = await translateToAllLanguages(text);
                if (!translatedText) {
                    return new Response(JSON.stringify({ success: true, skipped: true }), { status: 200, headers });
                }

                if (app === 'neighbourhood') {
                    await firestorePatch(`neighbourhood_posts/${msgId}`, { translation: translatedText }, accessToken);
                } else {
                    await writeTranslationsByLang(translatedText, msgId, accessToken);
                }

                return new Response(JSON.stringify({ success: true, msgId, translation: translatedText }), { status: 200, headers });
            }

            if (reprocess && msgId) {
                let translatedText = await translateToAllLanguages(text);

                if (app === 'neighbourhood') {
                    await firestorePatch(`neighbourhood_posts/${msgId}`, {
                        translation: translatedText || null,
                        reprocessedAt: new Date()
                    }, accessToken);
                } else {
                    if (translatedText) {
                        await writeTranslationsByLang(translatedText, msgId, accessToken);
                    }
                    await rtdbPatchWithAccessToken(`kindlechat/messages/${msgId}`, {
                        translation: translatedText || null,
                        reprocessedAt: { ".sv": "timestamp" }
                    }, accessToken);
                }

                return new Response(JSON.stringify({
                    success: true,
                    msgId,
                    translation: translatedText
                }), { status: 200, headers });
            }

            // NORMAL SEND LOGIC
            if (!uid || (!text && text !== "")) {
                return new Response(JSON.stringify({ error: "Missing uid or text" }), { status: 400, headers });
            }

            let translatedText = await translateToAllLanguages(text);

            let docId;
            if (app === 'neighbourhood') {
                const dbPayload = {
                    text: text,
                    timestamp: new Date(),
                    uid: uid,
                    ...(translatedText && { translation: translatedText })
                };
                docId = await firestoreCreate('neighbourhood_posts', dbPayload, accessToken);
            } else {
                const dbPayload = {
                    text: text,
                    timestamp: { ".sv": "timestamp" },
                    uid: uid
                };

                const firebaseData = await rtdbPushWithAccessToken("kindlechat/messages", dbPayload, accessToken);
                docId = firebaseData.name;

                if (translatedText) {
                    await writeTranslationsByLang(translatedText, docId, accessToken);
                }
            }

            return new Response(JSON.stringify({
                success: true,
                id: docId,
                translation: translatedText
            }), { status: 200, headers });

        } catch (err) {
            console.error("Worker Catch:", err.message);
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }
};
