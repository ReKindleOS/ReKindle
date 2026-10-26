/*
 * ReKindle translate client (2026-10-26)
 *
 * Browser-side translation for the Translator app, KindleChat and
 * Neighbourhood.
 *
 * WHY CLIENT-SIDE (read before changing providers)
 * ------------------------------------------------
 * The old server path (workers/rekindle-translate + translate.html's lingva.ml)
 * scraped Google's unofficial `translate_a/single?client=gtx` endpoint. Since
 * 2026-10-19 that endpoint answers every non-Google client with its
 * "Our systems have detected unusual traffic" page: verified from a residential
 * IP, from Cloudflare Pages egress (via /api/proxy) and against every public
 * lingva mirror (three return a Cloudflare challenge, two return 500, one is a
 * paused deployment). The stored chat translations stop on 2026-10-19 and no
 * message after that has one.
 *
 * So translation now runs in the reader's browser, against an API that sends a
 * plain `Access-Control-Allow-Origin: *`:
 *
 *   MyMemory  GET  /get?q=..&langpair=en|es&de=<contact email>
 *   5,000 characters/day per IP anonymous, 50,000/day with a reachable contact
 *   address (https://mymemory.translated.net/doc/usagelimits.php). Billed in
 *   CHARACTERS, not requests, and the budget is per IP, so a household/school
 *   network shares it.
 *
 * LANGUAGE DETECTION IS LOCAL (2026-10-26, after a beta CORS failure):
 * translate.disroot.org's LibreTranslate sends `Access-Control-Allow-Origin: *`
 * **together with** `Access-Control-Allow-Credentials: true`. The Fetch spec
 * forbids that pair and WebKit — the Kindle and Safari engine — enforces it, so
 * every POST to it fails with "Origin … is not allowed by
 * Access-Control-Allow-Origin. Status code: 200" while curl and desktop Chrome
 * accept it. Confirmed in WKWebView: disroot POST throws "A network error
 * occurred", MyMemory GET returns 200. So the LibreTranslate fallback and its
 * /detect call are gone; `detect()` is a local heuristic over script ranges and
 * Latin stopwords. Do not add another cross-origin POST provider without testing
 * it inside WebKit first.
 *
 * This costs zero Cloudflare Worker/Pages invocations, zero Firebase
 * operations and zero OpenAI calls. Keep it that way: do not move this behind a
 * Worker on the main account (100k/day Free cap), and if a Worker is ever
 * needed use the ReKindle Social account (js/social-endpoints.js). Two
 * consequences to preserve:
 *   - On-demand only. Never translate a rendered feed (one request per message
 *     per reader would blow the daily character budget and stall e-ink).
 *   - Cache aggressively. Chat is repetitive, so identical strings are free.
 *
 * KINDLE: ES2019 only (no `?.`, no `??`), system fonts, no animation changes.
 */
(function () {
    'use strict';

    if (window.rekindleTranslateClient) return;

    var MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
    // A reachable contact address raises MyMemory's per-IP budget 10x (5,000 ->
    // 50,000 characters/day). It is the public project address, as MyMemory asks.
    var MYMEMORY_CONTACT = 'hello@rekindle.ink';
    var TIMEOUT_MS = 12000;
    // MyMemory rejects `q` longer than 500 characters; chunk below that.
    var MAX_CHUNK = 450;
    // Hard ceiling so one feed scroll cannot drain the per-IP daily budget.
    var SESSION_BUDGET = 200;
    var CACHE_PREFIX = 'rk-tr:';
    var COUNT_KEY = 'rk-tr-calls';
    // MyMemory reports quota/parameter problems as a 200 with a sentence in
    // translatedText. Those must never be shown as if they were a translation.
    var BAD_RESULT = /MYMEMORY WARNING|INVALID LANGUAGE PAIR|PLEASE SELECT TWO DISTINCT|USED ALL AVAILABLE FREE TRANSLATIONS/i;

    var memoryCache = {};

    function makeError(code, message) {
        var err = new Error(message || code);
        err.code = code;
        return err;
    }

    // Cheap deterministic hash (FNV-1a) for cache keys; never user-visible.
    function hashText(text) {
        var h = 0x811c9dc5;
        for (var i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(36) + '-' + text.length.toString(36);
    }

    function cacheKey(text, source, target) {
        return CACHE_PREFIX + target + ':' + (source || 'auto') + ':' + hashText(text);
    }

    function readCache(key) {
        if (Object.prototype.hasOwnProperty.call(memoryCache, key)) return memoryCache[key];
        try {
            var stored = sessionStorage.getItem(key);
            if (stored !== null) {
                memoryCache[key] = stored;
                return stored;
            }
        } catch (e) { /* private mode / storage disabled */ }
        return null;
    }

    function writeCache(key, value) {
        memoryCache[key] = value;
        try { sessionStorage.setItem(key, value); } catch (e) { /* best effort */ }
    }

    function callsUsed() {
        try { return parseInt(sessionStorage.getItem(COUNT_KEY) || '0', 10) || 0; } catch (e) { return 0; }
    }

    function noteCall() {
        try { sessionStorage.setItem(COUNT_KEY, String(callsUsed() + 1)); } catch (e) { /* best effort */ }
    }

    function fetchWithTimeout(url, options) {
        if (typeof AbortController === 'undefined') return fetch(url, options);
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
        var opts = options || {};
        opts.signal = controller.signal;
        return fetch(url, opts).then(function (res) {
            clearTimeout(timer);
            return res;
        }, function (err) {
            clearTimeout(timer);
            throw err;
        });
    }

    // Split on newlines first (they carry meaning in posts/comments), then on a
    // whitespace boundary below MAX_CHUNK so no word is cut in half.
    function chunkParagraphs(text) {
        var paragraphs = String(text).split('\n');
        var result = [];
        for (var p = 0; p < paragraphs.length; p++) {
            var rest = paragraphs[p];
            var parts = [];
            while (rest.length > MAX_CHUNK) {
                var cut = rest.lastIndexOf(' ', MAX_CHUNK);
                if (cut < MAX_CHUNK / 2) cut = MAX_CHUNK;
                parts.push(rest.slice(0, cut));
                rest = rest.slice(cut).replace(/^\s+/, '');
            }
            parts.push(rest);
            result.push(parts);
        }
        return result;
    }

    async function myMemoryTranslate(text, source, target) {
        var url = MYMEMORY_URL +
            '?q=' + encodeURIComponent(text) +
            '&langpair=' + encodeURIComponent(source + '|' + target) +
            '&de=' + encodeURIComponent(MYMEMORY_CONTACT);
        var res = await fetchWithTimeout(url);
        if (!res.ok) throw makeError('unavailable', 'MyMemory HTTP ' + res.status);
        var data = await res.json();
        var out = data && data.responseData ? data.responseData.translatedText : null;
        if (!out || typeof out !== 'string' || BAD_RESULT.test(out)) {
            throw makeError('unavailable', 'MyMemory returned no translation');
        }
        return out;
    }

    async function translateChunk(text, source, target) {
        try {
            return await myMemoryTranslate(text, source, target);
        } catch (e) {
            // One retry, and only for a transient failure. There is deliberately
            // no second provider: the only free one that supported the same pairs
            // (LibreTranslate) sends ACAO:* with Allow-Credentials:true, which
            // WebKit rejects outright.
            if (e && (e.code === 'unavailable')) {
                await new Promise(function (r) { setTimeout(r, 250); });
                return await myMemoryTranslate(text, source, target);
            }
            throw e;
        }
    }

    // --- LOCAL LANGUAGE DETECTION -------------------------------------------------
    // No network: instant, works offline, no quota, and immune to the CORS bug
    // above. It only has to be good enough to choose the SOURCE language of a
    // short chat message or a pasted paragraph for one of the languages the app
    // offers. Script ranges settle CJK/Cyrillic; Latin languages are scored on
    // high-frequency stopwords, with a few unambiguous character hints.
    var SCRIPT_HINTS = [
        { lang: 'ja', re: /[\u3040-\u30FF]/ },   // Hiragana/Katakana (before Han)
        { lang: 'ko', re: /[\uAC00-\uD7AF\u1100-\u11FF]/ }, // Hangul
        { lang: 'zh', re: /[\u4E00-\u9FFF]/ },   // Han
        { lang: 'ru', re: /[\u0400-\u04FF]/ }    // Cyrillic
    ];

    // Word sets (already lowercased). Deliberately overlapping common words
    // ("la", "de", "que", "no") are left out where they would not discriminate.
    var STOPWORDS = {
        // 'me', 'it' and 'at' are deliberately absent: too ambiguous across the
        // Latin languages to outweigh a real stopword.
        en: ['the', 'and', 'is', 'are', 'you', 'to', 'of', 'in', 'for', 'that', 'have', 'not', 'this', 'with', 'on', 'was', 'but', 'they', 'what', 'how', 'can', 'do', 'my', 'good', 'thanks', 'hello', 'help', 'know', 'want'],
        es: ['el', 'los', 'las', 'de', 'que', 'y', 'en', 'es', 'un', 'una', 'por', 'con', 'para', 'muy', 'pero', 'como', 'está', 'estoy', 'hola', 'gracias', 'porque', 'cuando', 'tengo', 'bien', 'nada', 'ahora', 'también', 'gusta', 'gustan', 'quiero', 'soy', 'eres', 'tienes'],
        fr: ['le', 'les', 'des', 'du', 'et', 'est', 'une', 'pour', 'avec', 'pas', 'que', 'je', 'tu', 'il', 'nous', 'vous', 'bonjour', 'merci', 'très', 'mais', 'dans', 'oui', 'bien', 'tout', 'plus', 'ça', 'alors', 'ici', 'quoi'],
        de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'eine', 'mit', 'für', 'ich', 'du', 'wir', 'sie', 'auf', 'den', 'dem', 'zu', 'auch', 'aber', 'wie', 'was', 'sehr', 'danke', 'hallo', 'oder', 'noch', 'mir', 'dir', 'doch', 'nein', 'gut'],
        it: ['il', 'lo', 'gli', 'le', 'di', 'che', 'è', 'un', 'una', 'per', 'con', 'non', 'sono', 'come', 'questo', 'molto', 'ciao', 'grazie', 'ma', 'anche', 'della', 'più', 'stai', 'mille', 'perché', 'bene'],
        pt: ['os', 'as', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'muito', 'como', 'está', 'olá', 'obrigado', 'mas', 'também', 'você', 'ele', 'ela', 'isso', 'aqui', 'sei', 'estou', 'sim', 'nada']
    };

    var WORD_SPLIT = /[^0-9a-z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]+/;

    function detectSync(text, fallback) {
        var body = String(text === null || text === undefined ? '' : text);
        if (!body.trim()) return fallback || 'en';

        for (var i = 0; i < SCRIPT_HINTS.length; i++) {
            if (SCRIPT_HINTS[i].re.test(body)) return SCRIPT_HINTS[i].lang;
        }

        var tokens = body.toLowerCase().split(WORD_SPLIT);
        var scores = {};
        var bestLang = null;
        var bestScore = 0;
        for (var lang in STOPWORDS) {
            if (!Object.prototype.hasOwnProperty.call(STOPWORDS, lang)) continue;
            var words = STOPWORDS[lang];
            var score = 0;
            for (var t = 0; t < tokens.length; t++) {
                if (tokens[t] && words.indexOf(tokens[t]) !== -1) score++;
            }
            scores[lang] = score;
            if (score > bestScore) { bestScore = score; bestLang = lang; }
        }

        // Character hints break a tie or an empty score for the Latin languages.
        if (bestScore <= 1) {
            if (/[ñ¿¡]/.test(body)) return 'es';
            if (/[ß]/.test(body)) return 'de';
            if (/[ãõ]/.test(body)) return 'pt';
            if (/ção|ções/.test(body)) return 'pt';
            if (/zione|zioni/.test(body)) return 'it';
        }
        if (bestLang) return bestLang;

        // Nothing matched: ASCII-only text is far more likely to be English than
        // anything else here, and the caller treats source === target as a no-op.
        return fallback || 'en';
    }

    function detect(text, fallback) {
        // Kept async for callers that await it; the work itself is synchronous.
        return Promise.resolve(detectSync(text, fallback));
    }

    async function translate(text, source, target) {
        var body = String(text === null || text === undefined ? '' : text);
        if (!body.trim()) throw makeError('empty', 'Nothing to translate');
        if (!target) throw makeError('bad-target', 'No target language');
        if (source === target) return body;

        var resolved = source;
        if (!resolved || resolved === 'auto') {
            resolved = await detect(body);
            if (resolved === target) return body;
        }

        var key = cacheKey(body, resolved, target);
        var cached = readCache(key);
        if (cached !== null) return cached;

        if (callsUsed() >= SESSION_BUDGET) {
            throw makeError('budget', 'Translation budget for this session is used up');
        }

        var paragraphs = chunkParagraphs(body);
        var outParagraphs = [];
        for (var p = 0; p < paragraphs.length; p++) {
            var parts = paragraphs[p];
            var translatedParts = [];
            for (var c = 0; c < parts.length; c++) {
                if (!parts[c].trim()) {
                    translatedParts.push(parts[c]);
                    continue;
                }
                noteCall();
                translatedParts.push(await translateChunk(parts[c], resolved, target));
            }
            outParagraphs.push(translatedParts.join(' ').replace(/\s{2,}/g, ' ').trim());
        }

        var result = outParagraphs.join('\n');
        if (!result.trim()) throw makeError('unavailable', 'Empty translation');
        writeCache(key, result);
        return result;
    }

    async function translateAuto(text, target) {
        var source = await detect(String(text));
        var translated = await translate(text, source, target);
        return { text: translated, source: source };
    }

    window.rekindleTranslateClient = {
        translate: translate,
        translateAuto: translateAuto,
        detect: detect,
        // Exposed for tests/diagnostics only.
        _detectSync: detectSync,
        _sessionBudget: SESSION_BUDGET,
        _contact: MYMEMORY_CONTACT
    };
})();
