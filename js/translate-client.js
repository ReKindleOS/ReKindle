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
 * /detect call are gone. `detect()` delegates to js/lang-detect.js when that
 * lazy-loaded bundle is present (ELD + a chat lexicon, see
 * scripts/build-lang-detect.js), and otherwise uses the old script/stopword
 * heuristic as a fallback. Do not add another cross-origin POST provider
 * without testing it inside WebKit first.
 *
 * This costs zero Cloudflare Worker/Pages invocations, zero Firebase
 * operations and zero OpenAI calls. Keep it that way: do not move this behind a
 * Worker on the main account (100k/day Free cap), and if a Worker is ever
 * needed use the ReKindle Social account (js/social-endpoints.js).
 *
 * AUTO-TRANSLATION (2026-10-26): social pages translate a post/message on view
 * when its stored `lang` differs from the reader's language (or is missing and
 * the on-view detector finds a foreign language). That is opt-out
 * via KindleChat's showTranslations setting, queued one request at a time with
 * its own 24-job ceiling (`autoTranslate()`), and cached in sessionStorage by
 * exact text, so a re-render or a second reader on the same device is free.
 * Do not turn this into a feed-wide fan-out: the MyMemory budget is per IP and
 * billed in characters.
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

    // --- LANGUAGE DETECTION -------------------------------------------------------
    // js/lang-detect.js (ELD + a chat lexicon) is the accurate path. It is loaded
    // lazily by js/post-language.js because the n-gram database is ~365 KB. When
    // it is absent, the script/stopword heuristic below keeps manual translation
    // and the Translator app working; it is deliberately labelled unreliable.
    function normalizeLang(code) {
        if (!code || typeof code !== 'string') return '';
        var base = code.toLowerCase().replace(/_/g, '-').split('-')[0];
        if (base === 'iw') return 'he';
        if (base === 'in') return 'id';
        if (base === 'nb' || base === 'nn') return 'no';
        return base;
    }

    function sameLanguage(a, b) {
        var left = normalizeLang(a);
        var right = normalizeLang(b);
        return !!left && left === right;
    }

    var SCRIPT_HINTS = [
        { lang: 'ja', re: /[\u3040-\u30FF]/ },   // Hiragana/Katakana (before Han)
        { lang: 'ko', re: /[\uAC00-\uD7AF\u1100-\u11FF]/ }, // Hangul
        { lang: 'zh', re: /[\u4E00-\u9FFF]/ },   // Han
        { lang: 'ru', re: /[\u0400-\u04FF]/ },   // Cyrillic
        { lang: 'ar', re: /[\u0600-\u06FF]/ },
        { lang: 'he', re: /[\u0590-\u05FF]/ },
        { lang: 'el', re: /[\u0370-\u03FF]/ },
        { lang: 'th', re: /[\u0E00-\u0E7F]/ },
        { lang: 'hi', re: /[\u0900-\u097F]/ }
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
        pt: ['os', 'as', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'muito', 'como', 'está', 'olá', 'obrigado', 'mas', 'também', 'você', 'ele', 'ela', 'isso', 'aqui', 'sei', 'estou', 'sim', 'nada'],
        pl: ['i', 'a', 'ale', 'czy', 'że', 'bo', 'więc', 'tak', 'nie', 'jest', 'są', 'był', 'była', 'było', 'być', 'jestem', 'jesteś', 'mam', 'masz', 'ma', 'mamy', 'chcę', 'chcesz', 'chce', 'mogę', 'możesz', 'może', 'muszę', 'musisz', 'musi', 'wiem', 'wiesz', 'wie', 'się', 'jak', 'gdzie', 'kiedy', 'dlaczego', 'kto', 'co', 'który', 'która', 'które', 'ja', 'ty', 'on', 'ona', 'my', 'wy', 'oni', 'mnie', 'ciebie', 'jego', 'jej', 'nas', 'was', 'ich', 'mój', 'moja', 'moje', 'twój', 'twoja', 'twoje', 'nasz', 'nasza', 'wasz', 'wasza', 'dziękuję', 'dzięki', 'proszę', 'przepraszam', 'cześć', 'hej', 'dzień', 'dobry', 'dobra', 'dobre', 'tak', 'już', 'jeszcze', 'bardzo', 'tylko', 'tutaj', 'tam'],
        vi: ['và', 'là', 'của', 'có', 'không', 'được', 'trong', 'một', 'những', 'các', 'cho', 'với', 'để', 'này', 'đó', 'nào', 'gì', 'ai', 'sao', 'vì', 'nếu', 'thì', 'mà', 'nhưng', 'hoặc', 'cũng', 'rất', 'quá', 'lắm', 'hơn', 'nhất', 'chỉ', 'đã', 'đang', 'sẽ', 'tôi', 'mình', 'bạn', 'anh', 'chị', 'em', 'chúng', 'họ', 'nó', 'người', 'cái', 'con', 'việc', 'điều', 'khi', 'giờ', 'hôm', 'nay', 'mai', 'ngày', 'tuần', 'nhà', 'học', 'ăn', 'uống', 'ngủ', 'đi', 'đến', 'về', 'nói', 'biết', 'hiểu', 'thích', 'yêu', 'muốn', 'cần', 'phải', 'làm', 'cảm', 'ơn', 'xin', 'chào', 'tạm', 'biệt', 'hẹn', 'gặp', 'lại', 'khỏe', 'vui', 'buồn', 'tốt', 'xấu', 'đẹp', 'hay', 'ngon']
    };

    var WORD_SPLIT = /[^0-9a-z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]+/;

    var LATIN_HINT = /[A-Za-z\u00C0-\u024F]/g;

    function countHint(text, re) {
        // SCRIPT_HINTS regexes are reused (`lastIndex` would make `.test` stateful),
        // so build a fresh global matcher for counting.
        var m = text.match(new RegExp(re.source, 'g'));
        return m ? m.length : 0;
    }

    function heuristicDetect(body, fallback) {
        var latin = countHint(body, LATIN_HINT);
        var bestScript = null;
        var bestCount = 0;
        for (var h = 0; h < SCRIPT_HINTS.length; h++) {
            var scriptCount = countHint(body, SCRIPT_HINTS[h].re);
            if (scriptCount > bestCount) {
                bestCount = scriptCount;
                bestScript = SCRIPT_HINTS[h].lang;
            }
        }
        if (bestScript) {
            // A single kana/hangul character is usually ASCII art. A non-Latin
            // script also has to be at least as common as Latin text to win.
            var scriptAllowed = (bestScript === 'ja' || bestScript === 'ko')
                ? bestCount >= 2
                : !(latin > 0 && bestCount < latin);
            if (scriptAllowed) return bestScript;
        }

        var tokens = body.toLowerCase().split(WORD_SPLIT);
        var bestLang = null;
        var bestScore = 0;
        for (var lang in STOPWORDS) {
            if (!Object.prototype.hasOwnProperty.call(STOPWORDS, lang)) continue;
            var words = STOPWORDS[lang];
            var score = 0;
            for (var t = 0; t < tokens.length; t++) {
                if (tokens[t] && words.indexOf(tokens[t]) !== -1) score++;
            }
            if (score > bestScore) { bestScore = score; bestLang = lang; }
        }

        // Character hints break a tie or an empty score for the Latin languages.
        if (bestScore <= 1) {
            if (/[ñ¿¡]/.test(body)) return 'es';
            if (/[ß]/.test(body)) return 'de';
            if (/[ãõ]/.test(body)) return 'pt';
            if (/ção|ções/.test(body)) return 'pt';
            if (/zione|zioni/.test(body)) return 'it';
            if (/[ąćęłńóśźż]/.test(body)) return 'pl';
            if (/[ơưạảấầẩẫậđẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/.test(body)) return 'vi';
        }
        if (bestLang) return bestLang;

        // Nothing matched. `detectSync` supplies 'en'; the auto queue passes ''
        // so it can tell unknown/ASCII-art text from English.
        return fallback || '';
    }

    function detectInfo(text, fallback) {
        var body = String(text === null || text === undefined ? '' : text);
        if (!body.trim()) return { lang: fallback || '', reliable: false, source: 'none' };
        if (window.rekindleLangDetect && typeof window.rekindleLangDetect.detect === 'function') {
            try {
                var info = window.rekindleLangDetect.detect(body);
                return {
                    lang: (info && info.lang) || fallback || '',
                    reliable: !!(info && info.reliable),
                    source: (info && info.source) || 'lang-detect'
                };
            } catch (e) {
                // Fall through to the stopword heuristic; a detector bug must
                // not make the Translate button do nothing.
                if (typeof console !== 'undefined' && console.warn) console.warn('lang-detect failed:', e);
            }
        }
        return { lang: heuristicDetect(body, fallback), reliable: false, source: 'heuristic' };
    }

    function detectSync(text, fallback) {
        // Public detection calls default to en (the old heuristic contract); the
        // auto queue calls detectInfo() directly with '' to keep "unknown".
        return detectInfo(text, typeof fallback === 'undefined' ? 'en' : fallback).lang;
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

    // --- AUTO-TRANSLATION QUEUE ------------------------------------------------
    // One request at a time, 350 ms apart, 24 jobs per page view. The explicit
    // Translate link stays visible as the fallback if the queue stops (budget,
    // offline, provider error).
    var AUTO_MAX_JOBS = 24;
    var AUTO_QUEUE_MAX = 60;
    var AUTO_MAX_CHARS = 20000;
    var AUTO_GAP_MS = 350;
    var autoQueue = [];
    var autoAttempted = {};
    var autoActive = false;
    var autoStopped = false;
    var autoTimer = null;
    var autoJobsStarted = 0;
    var autoChars = 0;
    var autoFailures = 0;

    function autoKey(opts) {
        if (opts.id) return 'id:' + opts.id + ':' + normalizeLang(opts.target);
        return 'txt:' + hashText(String(opts.text || '')) + ':' + normalizeLang(opts.target);
    }

    function drainAutoQueue() {
        autoTimer = null;
        if (autoActive || autoStopped) return;
        var job = autoQueue.shift();
        if (!job) return;
        autoActive = true;

        // A message with no stored `lang` is detected here instead. Wait for the
        // accurate detector bundle rather than sending the stopword heuristic's
        // guess to MyMemory; `load()` is idempotent and resolves null on failure.
        var prepare = Promise.resolve();
        if ((!job.source || job.source === 'auto') && window.rekindlePostLanguage &&
            typeof window.rekindlePostLanguage.load === 'function') {
            try {
                prepare = Promise.resolve(window.rekindlePostLanguage.load()).catch(function () { return null; });
            } catch (e) {
                prepare = Promise.resolve();
            }
        }

        prepare.then(function () {
            var source = job.source;
            if (!source || source === 'auto') {
                // `source:'auto'` means the caller had no stored language. Use
                // the detector's answer, but treat "none" as unknown rather than
                // defaulting to English and translating ASCII art.
                var info = detectInfo(job.text, '');
                source = (info && info.lang && info.source !== 'none') ? info.lang : '';
            }

            // Do not let an unknown-but-same-language message burn the network
            // budget or a queue slot. The page's apply() sees the original text
            // and retires the now-pointless Translate link.
            if (sameLanguage(source, job.target)) {
                autoActive = false;
                autoFailures = 0;
                try {
                    if (typeof job.apply === 'function') job.apply(job.text);
                } catch (e) {
                    if (typeof console !== 'undefined' && console.warn) console.warn('auto-translate apply failed:', e);
                }
                autoTimer = setTimeout(drainAutoQueue, 20);
                return;
            }

            if (autoJobsStarted >= AUTO_MAX_JOBS) {
                autoActive = false;
                autoStopped = true;
                autoQueue.length = 0;
                return;
            }
            if (autoChars + String(job.text).length > AUTO_MAX_CHARS) {
                autoActive = false;
                autoStopped = true;
                autoQueue.length = 0;
                return;
            }

            autoJobsStarted++;
            autoChars += String(job.text).length;
            return translate(job.text, source, job.target).then(function (translated) {
                autoActive = false;
                autoFailures = 0;
                try {
                    if (typeof job.apply === 'function' && translated) job.apply(translated);
                } catch (e) {
                    // A page render bug must not wedge the queue.
                    if (typeof console !== 'undefined' && console.warn) console.warn('auto-translate apply failed:', e);
                }
                autoTimer = setTimeout(drainAutoQueue, AUTO_GAP_MS);
            }, function (err) {
                autoActive = false;
                if (err && err.code === 'budget') {
                    autoStopped = true;
                } else {
                    autoFailures++;
                    // Three consecutive provider/network failures: stop rather than
                    // hammer MyMemory (or a dead network) for the rest of the feed.
                    if (autoFailures >= 3) autoStopped = true;
                }
                try {
                    if (typeof job.onFail === 'function') job.onFail(err);
                } catch (e) { /* best effort */ }
                autoTimer = setTimeout(drainAutoQueue, AUTO_GAP_MS);
            });
        });
    }

    function autoTranslate(opts) {
        if (!opts || !opts.text || !opts.target) return false;
        if (autoStopped) return false;
        if (opts.source && sameLanguage(opts.source, opts.target)) return false;
        var key = autoKey(opts);
        if (autoAttempted[key]) return false;
        // Queue capacity is deliberately larger than the network-request cap:
        // same-language/unknown jobs drain without a request and must not block
        // a later foreign message in the same feed.
        if (autoQueue.length >= AUTO_QUEUE_MAX) return false;
        autoAttempted[key] = true;
        autoQueue.push(opts);
        if (!autoActive && !autoTimer) autoTimer = setTimeout(drainAutoQueue, 120);
        return true;
    }

    function resetAutoTranslate() {
        autoQueue.length = 0;
        autoAttempted = {};
        autoActive = false;
        autoStopped = false;
        autoJobsStarted = 0;
        autoChars = 0;
        autoFailures = 0;
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    }

    window.rekindleTranslateClient = {
        translate: translate,
        translateAuto: translateAuto,
        detect: detect,
        detectInfo: detectInfo,
        normalizeLang: normalizeLang,
        sameLanguage: sameLanguage,
        autoTranslate: autoTranslate,
        // Exposed for tests/diagnostics only.
        _detectSync: detectSync,
        _resetAutoTranslate: resetAutoTranslate,
        _autoMaxJobs: AUTO_MAX_JOBS,
        _autoQueueMax: AUTO_QUEUE_MAX,
        _sessionBudget: SESSION_BUDGET,
        _contact: MYMEMORY_CONTACT
    };
})();
