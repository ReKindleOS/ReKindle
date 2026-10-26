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
 * So translation now runs in the reader's browser, against APIs that send
 * `Access-Control-Allow-Origin: *`:
 *
 *   1. MyMemory  GET  /get?q=..&langpair=en|es&de=<contact email>
 *      5,000 characters/day per IP anonymous, 50,000/day with a reachable
 *      contact address (https://mymemory.translated.net/doc/usagelimits.php).
 *      Billed in CHARACTERS, not requests, and the budget is per IP, so a
 *      household/school network shares it.
 *   2. LibreTranslate at translate.disroot.org (fallback, plus language
 *      detection for the "Detect" option). Measured limit: 3 requests/minute
 *      per IP ("Slowdown: 3 per 1 minute" on the fourth), so it is never the
 *      primary translator and detection is one request.
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
    var LIBRE_URL = 'https://translate.disroot.org';
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

    async function libreTranslate(text, source, target) {
        var res = await fetchWithTimeout(LIBRE_URL + '/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: text,
                source: source || 'auto',
                target: target,
                format: 'text'
            })
        });
        if (res.status === 429) throw makeError('unavailable', 'LibreTranslate rate limited');
        if (!res.ok) throw makeError('unavailable', 'LibreTranslate HTTP ' + res.status);
        var data = await res.json();
        if (!data || typeof data.translatedText !== 'string' || !data.translatedText) {
            throw makeError('unavailable', 'LibreTranslate returned no translation');
        }
        return data.translatedText;
    }

    async function translateChunk(text, source, target) {
        try {
            return await myMemoryTranslate(text, source, target);
        } catch (e) {
            // One fallback only: disroot allows 3 requests/minute per IP, so a
            // retry loop here would spend the budget on 429s.
            return await libreTranslate(text, source, target);
        }
    }

    async function detect(text) {
        var res = await fetchWithTimeout(LIBRE_URL + '/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: text })
        });
        if (!res.ok) throw makeError('detect', 'Language detection failed');
        var data = await res.json();
        var best = null;
        if (Array.isArray(data)) {
            for (var i = 0; i < data.length; i++) {
                var row = data[i];
                if (!row || typeof row.language !== 'string') continue;
                if (!best || (row.confidence || 0) > (best.confidence || 0)) best = row;
            }
        }
        if (!best) throw makeError('detect', 'Language detection returned nothing');
        return best.language;
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
        _sessionBudget: SESSION_BUDGET,
        _contact: MYMEMORY_CONTACT
    };
})();
