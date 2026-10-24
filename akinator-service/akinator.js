/**
 * Akinator relay for rekindle.ink
 *
 * akinator.html used to talk to en.akinator.com through public CORS proxies.
 * Akinator.com now sits behind Cloudflare bot protection that fingerprints the
 * TLS ClientHello (JA3/JA4), so every plain HTTP client (browser fetch through
 * a proxy, Cloudflare Workers, undici, curl) gets a 403 "Just a moment..." page
 * while a Chrome-impersonating client gets the real game page. Browsers cannot
 * call Akinator directly because it sends no CORS headers, so the only way to
 * keep the game working is a relay with a Chrome TLS fingerprint.
 *
 * `got-scraping` is used for that fingerprint. It is imported lazily so the
 * service starts fast and the dependency is only loaded on the first game
 * request.
 *
 * Deployment (2026-10): this file is hosted by `akinator-service/` as a plain
 * always-on Node process (Northflank Developer Sandbox free tier). It has no
 * Firebase/GCP dependency: `server.js` listens on `$PORT`, so the same code can
 * move to any Node host without changes.
 *
 * The relay is stateless: Akinator's `session` token is enough for every call
 * (verified 2026-10 with and without cookies), so each HTTP request maps to one
 * Akinator request. No Firestore/RTDB/Auth/Storage access at all.
 *
 * Protocol (all values scraped from the live site, 2026-10):
 *   start    POST /game            {cm, sid, anim}          -> HTML
 *   answer   POST /answer          {step, progression, sid, cm, answer,
 *                                   step_last_proposition, session}
 *   back     POST /cancel_answer   {step, progression, sid, cm, session}
 *   continue POST /exclude         {..., forward_answer: '1'}
 *
 * Gotchas that break naive implementations:
 *   - `step` starts at 1 (the first question already counts). Sending 0 makes
 *     /answer return {"completion":"KO"}.
 *   - The old `signature` parameter no longer exists anywhere in the page.
 *   - /cancel_answer wants the *current* step, not step-1; the wrong value
 *     returns the full HTML game page instead of JSON.
 */

const ALLOWED_ORIGINS = [
    "https://rekindle.ink",
    "https://beta.rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
    "http://localhost:8788",
    "http://localhost:3000"
];

const AKINATOR_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// theme suffix in the region id -> Akinator `sid`
const AKINATOR_THEMES = { objects: 2, animals: 14 };

// Only hosts that actually resolve (gr./sp. do not) — an unknown code would
// otherwise burn a 9s upstream timeout before failing.
const AKINATOR_LANGUAGES = {
    en: 1, de: 1, es: 1, fr: 1, it: 1, nl: 1, pl: 1, pt: 1, ru: 1, tr: 1,
    id: 1, ar: 1, cn: 1, il: 1, jp: 1, kr: 1, uk: 1, vn: 1, fa: 1
};

// Per-process token bucket. Cheap abuse guard only: the relay is a single
// always-on Node process, so this map is shared by every concurrent request.
// Keep it loose enough that a fast player can finish several games (a game is
// ~21 calls).
const RATE_CAPACITY = 120;
const RATE_REFILL_PER_SEC = 2;
const buckets = new Map();

let gotScrapingModule = null;

class AkinatorError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status || 502;
    }
}

function loadGotScraping() {
    if (!gotScrapingModule) {
        gotScrapingModule = import("got-scraping").catch((e) => {
            gotScrapingModule = null;
            throw new AkinatorError("relay_unavailable", "Relay dependency failed to load", 503);
        });
    }
    return gotScrapingModule;
}

function regionInfo(region) {
    const parts = region.split("_");
    const sid = AKINATOR_THEMES[parts[1]] || 1;
    return {
        baseUrl: "https://" + parts[0] + ".akinator.com",
        sid: sid
    };
}

function buildForm(params) {
    const parts = [];
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (params[key] === undefined || params[key] === null) continue;
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
    }
    return parts.join("&");
}

function extractFirst(text, patterns) {
    let best = null;
    for (let i = 0; i < patterns.length; i++) {
        const flags = patterns[i].flags.indexOf("g") === -1 ? patterns[i].flags + "g" : patterns[i].flags;
        const regex = new RegExp(patterns[i].source, flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (match[1] && (!best || match[1].length > best.length)) best = match[1];
            if (match.index === regex.lastIndex) regex.lastIndex++;
        }
    }
    return best;
}

/**
 * Reduce scraped HTML to the plain text the client renders with textContent.
 *
 * This is defence in depth rather than the only guard: one `replace` pass can
 * be defeated by nested markup (`<<script>script>` leaves `<script>`), so the
 * tag strip repeats until stable and any leftover "<" is escaped. The result
 * therefore cannot contain an HTML tag at all. Entities stay encoded on
 * purpose - akinator.html decodes them with decodeHtml().
 */
function stripHtmlTags(html) {
    let text = String(html);
    let previous;
    do {
        previous = text;
        text = text.replace(/<[^>]*>/g, "");
    } while (text !== previous);
    return text.replace(/</g, "&lt;").trim();
}

function parseQuestion(html) {
    const match =
        html.match(/<p[^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\/p>/i) ||
        html.match(/id=["']question-label["'][^>]*>([\s\S]*?)<\/(?:p|div)/i);
    return match ? stripHtmlTags(match[1]) : "";
}

function parseAnswerLabels(html) {
    const ids = ["a_yes", "a_no", "a_dont_know", "a_probably", "a_probaly_not"];
    const answers = [];
    for (let i = 0; i < ids.length; i++) {
        const regex = new RegExp("<a[^>]*id=[\"']" + ids[i] + "[\"'][^>]*>([\\s\\S]*?)<\\/a>", "i");
        const match = html.match(regex);
        answers.push(match && match[1] ? stripHtmlTags(match[1]) : null);
    }
    return answers;
}

async function akinatorRequest(baseUrl, path, params, refererPath) {
    const { gotScraping } = await loadGotScraping();
    let res;
    try {
        res = await gotScraping({
            url: baseUrl + path,
            method: "POST",
            headers: {
                "user-agent": AKINATOR_UA,
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/x-www-form-urlencoded",
                "accept": "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                "origin": baseUrl,
                "referer": baseUrl + (refererPath || "/game")
            },
            body: buildForm(params),
            timeout: { request: 9000 },
            retry: { limit: 1 },
            throwHttpErrors: false,
            responseType: "text"
        });
    } catch (e) {
        throw new AkinatorError("upstream_timeout", "Akinator timed out", 504);
    }

    if (res.statusCode === 403 || res.statusCode === 429 || /Just a moment|cf-chl|cf_chl/i.test(res.body || "")) {
        throw new AkinatorError("upstream_blocked", "Akinator is blocking the relay", 502);
    }
    if (res.statusCode !== 200) {
        throw new AkinatorError("upstream_error", "Akinator returned HTTP " + res.statusCode, 502);
    }
    return res.body || "";
}

function parseAction(body, fallback) {
    let data;
    try {
        data = JSON.parse(body);
    } catch (e) {
        throw new AkinatorError("session_expired", "Akinator did not recognise this game session", 409);
    }
    if (!data || typeof data !== "object") {
        throw new AkinatorError("upstream_parse", "Akinator returned an unexpected response", 502);
    }
    if (data.completion === "KO") {
        throw new AkinatorError("session_expired", "Akinator did not recognise this game session", 409);
    }

    const out = {
        step: parseInt(data.step, 10),
        progression: parseFloat(data.progression),
        question: data.question ? String(data.question) : ""
    };
    if (isNaN(out.step)) out.step = fallback.step;
    if (isNaN(out.progression)) out.progression = fallback.progression;

    if (data.id_proposition || data.name_proposition) {
        out.guess = {
            id: String(data.id_proposition || data.id_base_proposition || ""),
            name: String(data.name_proposition || ""),
            description: String(data.description_proposition || ""),
            photo: String(data.photo || ""),
            noQuestion: String(data.no_question === undefined ? "0" : data.no_question) === "1"
        };
    }
    return out;
}

function readBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch (e) {
            throw new AkinatorError("bad_request", "Invalid JSON body", 400);
        }
    }
    return req.body;
}

function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
}

function requireSession(body) {
    const session = typeof body.session === "string" ? body.session : "";
    if (session.length < 8 || session.length > 300) {
        throw new AkinatorError("bad_request", "Missing or invalid session", 400);
    }
    return session;
}

function clientIp(req) {
    // Behind Northflank's (or any) reverse proxy, x-forwarded-for's first entry
    // is the caller. Prefer it so a missing `trust proxy` setting can't collapse
    // every user into one shared bucket.
    const xff = req.headers && req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
    return req.ip || "unknown";
}

function allowRequest(req) {
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket) {
        bucket = { tokens: RATE_CAPACITY, last: now };
        buckets.set(ip, bucket);
        if (buckets.size > 5000) buckets.clear();
    }
    bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + ((now - bucket.last) / 1000) * RATE_REFILL_PER_SEC);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
}

function parseRegion(region) {
    const parts = String(region || "en").split("_");
    if (!AKINATOR_LANGUAGES[parts[0]] || (parts[1] && !AKINATOR_THEMES[parts[1]]) || parts.length > 2) {
        throw new AkinatorError("bad_request", "Unsupported region", 400);
    }
    return parts[0] + (parts[1] ? "_" + parts[1] : "");
}

async function startGame(body) {
    const region = parseRegion(body.region);
    const info = regionInfo(region);

    const html = await akinatorRequest(
        info.baseUrl,
        "/game",
        { cm: body.childMode === true ? "true" : "false", sid: info.sid, anim: "false" },
        "/theme-selection"
    );

    const session = extractFirst(html, [
        /session:\s*'([^']+)'/,
        /session\s*[:=]\s*"([^"]+)"/,
        /id=["']session["'][^>]*value=["']([^"']+)["']/i,
        /value=["']([^"']+)["'][^>]*id=["']session["']/i
    ]);
    const question = parseQuestion(html);

    if (!session || !question) {
        throw new AkinatorError("upstream_parse", "Could not read the Akinator game page", 502);
    }

    return {
        session: session,
        question: question,
        step: 1,
        progression: 0,
        answers: parseAnswerLabels(html),
        baseUrl: info.baseUrl,
        sid: info.sid,
        region: region
    };
}

async function gameAction(body, action) {
    const region = parseRegion(body.region);
    const info = regionInfo(region);

    const session = requireSession(body);
    const step = toInt(body.step, 1);
    if (step < 1 || step > 1000) throw new AkinatorError("bad_request", "Invalid step", 400);
    let progression = parseFloat(body.progression);
    if (!isFinite(progression)) progression = 0;

    const common = {
        step: step,
        progression: progression,
        sid: info.sid,
        cm: body.childMode === true ? "true" : "false",
        session: session
    };

    if (action === "answer") {
        const answer = toInt(body.answer, -1);
        if (answer < 0 || answer > 4) throw new AkinatorError("bad_request", "Invalid answer", 400);
        common.answer = answer;
        common.step_last_proposition = body.stepLast ? String(body.stepLast) : "";
        const raw = await akinatorRequest(info.baseUrl, "/answer", common, "/game");
        return parseAction(raw, { step: step, progression: progression });
    }

    if (action === "back") {
        if (step <= 1) throw new AkinatorError("bad_request", "Already at the first question", 400);
        const raw = await akinatorRequest(info.baseUrl, "/cancel_answer", common, "/game");
        return parseAction(raw, { step: step - 1, progression: progression });
    }

    if (action === "continue") {
        common.forward_answer = "1";
        const raw = await akinatorRequest(info.baseUrl, "/exclude", common, "/game");
        return parseAction(raw, { step: step, progression: progression });
    }

    throw new AkinatorError("bad_request", "Unknown action", 400);
}

function applyCors(req, res) {
    const origin = req.headers && req.headers.origin;
    if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        res.set("Access-Control-Allow-Origin", origin);
    } else {
        res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "86400");
}

async function akinatorHandler(req, res) {
    applyCors(req, res);
    res.set("Cache-Control", "no-store");

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ error: "method_not_allowed", message: "Use POST" });
        return;
    }
    if (!allowRequest(req)) {
        res.status(429).json({ error: "rate_limited", message: "Too many requests, slow down" });
        return;
    }

    try {
        const body = readBody(req);
        const action = String(body.action || "");

        let result;
        if (action === "start") {
            result = await startGame(body);
        } else if (action === "answer" || action === "back" || action === "continue") {
            result = await gameAction(body, action);
        } else {
            throw new AkinatorError("bad_request", "Unknown action", 400);
        }

        res.status(200).json(result);
    } catch (e) {
        if (e instanceof AkinatorError) {
            res.status(e.status).json({ error: e.code, message: e.message });
            return;
        }
        console.error("akinator relay error:", e);
        res.status(500).json({ error: "internal", message: "Relay error" });
    }
}

// Exported for offline unit tests (scripts/test-akinator.js). Only
// `akinatorHandler` is used by the HTTP app.
module.exports = {
    akinatorHandler,
    ALLOWED_ORIGINS,
    AkinatorError,
    parseQuestion,
    parseAnswerLabels,
    parseAction,
    parseRegion,
    regionInfo,
    buildForm
};
