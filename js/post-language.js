/*
 * Post-time language detection helper (2026-10-26).
 *
 * js/lang-detect.js is ~365 KB raw / ~119 KB gzip (a trimmed ELD n-gram model
 * plus a chat lexicon). Loading that on every social page would undo the
 * Kindle load-path work, so it is injected on demand:
 *
 *   - when the reader focuses a composer (chat, post, comment, topic form),
 *     which gives the download time to finish while they type;
 *   - and again 4 s after the page loads, so an already-typed draft still gets
 *     a language tag.
 *
 * `detect()` is synchronous and never waits. If the bundle is not there yet it
 * uses the tiny stopword fallback in js/translate-client.js and marks the result
 * unreliable. Detection is best-effort: a message with no `lang` is detected on
 * view by the auto queue (which waits for this bundle), so legacy content is
 * translated too; same-language/unknown results are a no-op.
 */
(function () {
    'use strict';

    if (window.rekindlePostLanguage) return;

    var DETECT_URL = 'js/lang-detect.js?v=1';
    var loading = null;
    var failed = false;
    var failedAt = 0;

    function markReady() {
        return window.rekindleLangDetect || null;
    }

    function load() {
        if (markReady()) return Promise.resolve(markReady());
        if (loading) return loading;
        // A transient network failure must not disable accurate detection for
        // the whole session; retry after a minute.
        if (failed && (Date.now() - failedAt) < 60000) return Promise.resolve(null);
        failed = false;
        loading = new Promise(function (resolve) {
            var script = document.createElement('script');
            script.async = true;
            script.charset = 'utf-8';
            script.src = DETECT_URL;
            script.onload = function () {
                loading = null;
                if (!markReady()) { failed = true; failedAt = Date.now(); }
                resolve(markReady());
            };
            script.onerror = function () {
                loading = null;
                failed = true;
                failedAt = Date.now();
                resolve(null);
            };
            (document.head || document.documentElement).appendChild(script);
        });
        return loading;
    }

    function fallback(text) {
        var client = window.rekindleTranslateClient;
        if (client && typeof client.detectInfo === 'function') {
            return client.detectInfo(text);
        }
        if (client && typeof client._detectSync === 'function') {
            return { lang: client._detectSync(text), reliable: false, source: 'heuristic' };
        }
        return { lang: '', reliable: false, source: 'none' };
    }

    function detect(text) {
        var body = String(text === null || text === undefined ? '' : text);
        if (!body.trim()) return { lang: '', reliable: false, source: 'none' };
        if (window.rekindleLangDetect && typeof window.rekindleLangDetect.detect === 'function') {
            try {
                return window.rekindleLangDetect.detect(body);
            } catch (e) {
                // Never let a model bug block a post; fall back to stopwords.
                if (typeof console !== 'undefined' && console.warn) console.warn('lang-detect failed:', e);
            }
        }
        return fallback(body);
    }

    function detectLang(text) {
        return detect(text).lang || '';
    }

    function ensureAndDetect(text) {
        return load().then(function () { return detect(text); });
    }

    // Delayed preload: after the first paint and the live listeners have
    // settled, not before.
    function loadSoon(delay) {
        setTimeout(load, typeof delay === 'number' ? delay : 4000);
    }

    window.rekindlePostLanguage = {
        load: load,
        loadSoon: loadSoon,
        detect: detect,
        detectLang: detectLang,
        ensureAndDetect: ensureAndDetect
    };
})();
