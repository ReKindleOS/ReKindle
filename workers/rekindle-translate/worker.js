/**
 * REKINDLE CHAT - TRANSLATION WORKER
 * Deployed to Cloudflare Workers
 * 
 * Functionality:
 * 1. Receives chat message payload via POST
 * 2. Checks if message is an ASCII emoji (skips translation if so)
 * 3. Translates text to English using MyMemory API if needed
 * 4. Writes final record (original + translation) to Firebase RTDB
 */

const FIREBASE_URL = "https://rekindle-dd1fa-default-rtdb.firebaseio.com/kindlechat/messages.json";

// EMBEDDED EMOJI DATABASE (From emojis.js)
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
        { art: "ƪ(ړײ)‎ƪ​​", name: "Creeper" },
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

// Flatten to Set for fast lookup
const KNOWN_EMOJI_SET = new Set();
Object.values(ASCII_EMOJIS).forEach(list => {
    list.forEach(item => KNOWN_EMOJI_SET.add(item.art));
});

function isAsciiEmoji(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (KNOWN_EMOJI_SET.has(trimmed)) return true;

    // Heuristics
    const letters = trimmed.replace(/[^a-zA-Z]/g, '').length;
    const symbols = trimmed.length - letters;
    if (trimmed.length < 15 && symbols > letters) return true;
    if (/^[()0-9^>.<_ \-*\\/|]+$/.test(trimmed)) return true;

    return false;
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const allowedOrigins = [
        "https://beta.rekindle.pages.dev",
        "https://rekindle.ink",
        "https://lite.rekindle.ink",
        "https://legacy.rekindle.ink",
        "https://rekindle-pro.pages.dev",
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
    const token = authHeader ? authHeader.split(' ')[1] : null;

    try {
        const payload = await request.json();
        const { user, text, msgId, reprocess } = payload;

        console.log("Worker received payload:", JSON.stringify(payload));

        if (reprocess && msgId) {
            // REPROCESS LOGIC
            let translatedText = null;
            if (text && text.trim().length > 0 && !isAsciiEmoji(text)) {
                try {
                    let translateUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=AUTODETECT|en`;
                    if (typeof MYMEMORY_EMAIL !== 'undefined' && MYMEMORY_EMAIL) {
                        translateUrl += `&de=${encodeURIComponent(MYMEMORY_EMAIL)}`;
                    }
                    const translateResp = await fetch(translateUrl);
                    const translateData = await translateResp.json();
                    if (translateData && translateData.responseData && translateData.responseData.translatedText) {
                        if (translateData.responseData.translatedText.toLowerCase().trim() !== text.toLowerCase().trim()) {
                            translatedText = translateData.responseData.translatedText;
                        }
                    }
                } catch (e) {
                    console.error("Translation API Failed during reprocess", e);
                }
            }

            // Update specific message
            let updateUrl = FIREBASE_URL.replace(".json", `/${msgId}.json`);
            if (token) updateUrl += `?auth=${token}`;

            const firebaseResp = await fetch(updateUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    translation: translatedText || null,
                    reprocessedAt: { ".sv": "timestamp" }
                })
            });

            if (!firebaseResp.ok) {
                const errText = await firebaseResp.text();
                throw new Error(`Firebase update failed (${firebaseResp.status}): ${errText}`);
            }

            return new Response(JSON.stringify({ success: true, msgId, translation: translatedText }), { status: 200, headers });
        }

        // NORMAL SEND LOGIC
        if (!user || (!text && text !== "")) {
            return new Response(JSON.stringify({ error: "Missing user or text" }), { status: 400, headers });
        }

        let translatedText = null;

        // SKIP EMOJIS
        if (text && text.trim().length > 0 && !isAsciiEmoji(text)) {
            try {
                let translateUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=AUTODETECT|en`;
                if (typeof MYMEMORY_EMAIL !== 'undefined' && MYMEMORY_EMAIL) {
                    translateUrl += `&de=${encodeURIComponent(MYMEMORY_EMAIL)}`;
                }
                const translateResp = await fetch(translateUrl);
                const translateData = await translateResp.json();
                if (translateData && translateData.responseData && translateData.responseData.translatedText) {
                    if (translateData.responseData.translatedText.toLowerCase().trim() !== text.toLowerCase().trim()) {
                        translatedText = translateData.responseData.translatedText;
                    }
                }
            } catch (e) {
                console.error("Translation API Failed", e);
            }
        }

        const dbPayload = {
            user: user,
            text: text,
            timestamp: { ".sv": "timestamp" },
            ...(translatedText && { translation: translatedText })
        };

        let postUrl = FIREBASE_URL;
        if (token) postUrl += `?auth=${token}`;

        const firebaseResp = await fetch(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dbPayload)
        });

        if (!firebaseResp.ok) {
            const errText = await firebaseResp.text();
            throw new Error(`Firebase write failed (${firebaseResp.status}): ${errText}`);
        }

        const firebaseData = await firebaseResp.json();
        return new Response(JSON.stringify({ success: true, id: firebaseData.name, translation: translatedText }), { status: 200, headers });

    } catch (err) {
        console.error("Worker Catch:", err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}
