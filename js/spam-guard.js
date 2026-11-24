/**
 * KindleChat repetitive-message guard (client mirror).
 *
 * KEEP IN SYNC with chatTextShapes() / evaluateChatRepetition() in
 * workers/rekindle-moderate/worker.js - the worker is authoritative and this
 * copy only exists to block an obvious repeat instantly, with a clear modal,
 * instead of spending a round-trip on a request the worker will reject.
 *
 * Rules (same as the worker):
 *   - exact same message again within 5 minutes  -> blocked
 *   - 3rd near-identical message within 10 min   -> blocked
 * "Near-identical" means the same dominant word/letter (e.g. "hello",
 * "hello hello hello", "hellllooooo") or a Jaccard token overlap >= 0.5
 * (e.g. "hi hi hi" vs "hi hi hi bhi hi").
 *
 * State lives in localStorage, so this adds no Firebase reads or writes.
 */
(function () {
    'use strict';

    var STORE_KEY = 'rekindle_chat_recent_sent';
    var REPEAT_WINDOW_MS = 10 * 60 * 1000;
    var DUP_WINDOW_MS = 5 * 60 * 1000;
    var REPEAT_LIMIT = 2;
    var SIMILARITY = 0.5;
    var MAX_ENTRIES = 4;
    var MAX_TOKENS = 16;

    // Long-message duplicate ring (2026-11-24). The four shape slots above
    // cannot catch a flood that puts four different lines between each copy
    // of the same long paste - every copy evicts the one before it. Keep a
    // larger fingerprint ring for substantial messages only, so ordinary
    // short chat ("lol", "hi") is completely unaffected.
    var LONG_STORE_KEY = 'rekindle_chat_recent_long';
    var LONG_WINDOW_MS = 10 * 60 * 1000;
    var LONG_MAX_ENTRIES = 24;
    var LONG_MIN_CHARS = 40;

    var MSG_DUPLICATE = 'You just sent that message. Say something different - repeated messages are blocked to keep chat readable.';
    var MSG_REPEAT = 'You have sent the same message a few times. Please say something new - repeated messages are blocked to keep chat readable.';

    function translate(key, fallback) {
        if (typeof window.t === 'function') {
            var value = window.t(key, fallback);
            return value || fallback;
        }
        return fallback;
    }

    // DJB2, same as hashDedupeKey() in the moderation worker.
    function hashText(text) {
        var s = String(text || '');
        var hash = 5381;
        for (var i = 0; i < s.length; i++) {
            hash = ((hash << 5) + hash) + s.charCodeAt(i);
        }
        return String(hash >>> 0);
    }

    function normalizeForDedupe(text) {
        if (!text) return '';
        return String(text)
            .toLowerCase()
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Returns { toks: [hash, ...], dom: hash } for a message.
    function chatTextShapes(text) {
        var raw = String(text || '')
            .toLowerCase()
            .replace(/(^|\s)@[a-z0-9_.\-]+/g, ' ')
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!raw) return { toks: [], dom: '' };

        var cleaned = raw.replace(/(.)\1+/g, '$1');
        var words = cleaned.split(' ');
        var counts = {};
        var order = [];
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (!w) continue;
            if (counts[w]) { counts[w]++; } else { counts[w] = 1; order.push(w); }
        }

        var dominant = '';
        var letters = raw.replace(/\s+/g, '');
        if (letters.length >= 8) {
            var charCounts = {};
            var topChar = '';
            var topCharCount = 0;
            for (var c = 0; c < letters.length; c++) {
                var ch = letters.charAt(c);
                charCounts[ch] = (charCounts[ch] || 0) + 1;
                if (charCounts[ch] > topCharCount) { topCharCount = charCounts[ch]; topChar = ch; }
            }
            if (topCharCount >= Math.ceil(letters.length * 0.7)) dominant = hashText('#' + topChar);
        }
        if (!dominant) {
            var topWord = '';
            var topCount = 0;
            for (var k = 0; k < order.length; k++) {
                if (counts[order[k]] > topCount) { topCount = counts[order[k]]; topWord = order[k]; }
            }
            if (words.length === 1 || topCount >= Math.max(2, Math.ceil(words.length * 0.5))) {
                dominant = hashText(topWord.length === 1 ? ('#' + topWord) : topWord);
            }
        }

        var toks = [];
        for (var o = 0; o < order.length && toks.length < MAX_TOKENS; o++) {
            toks.push(hashText(order[o]));
        }
        return { toks: toks, dom: dominant };
    }

    function tokenOverlap(a, b) {
        if (!a.length || !b.length) return 0;
        var seen = {};
        var i;
        for (i = 0; i < b.length; i++) seen[b[i]] = 1;
        var shared = 0;
        for (i = 0; i < a.length; i++) { if (seen[a[i]]) shared++; }
        return shared / (a.length + b.length - shared);
    }

    function shapesMatch(shape, entry) {
        if (shape.dom && entry.d && shape.dom === entry.d) return true;
        return tokenOverlap(shape.toks, entry.k ? entry.k.split(' ') : []) >= SIMILARITY;
    }

    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
        } catch (e) {
            return [];
        }
    }

    function writeStore(list) {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
        } catch (e) {
            // localStorage may be unavailable or full - the worker still enforces.
        }
    }

    function recentEntries(now) {
        var list = readStore();
        var fresh = [];
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            if (!entry || typeof entry.t !== 'number') continue;
            if (now - entry.t < REPEAT_WINDOW_MS && now - entry.t >= 0) fresh.push(entry);
        }
        return fresh;
    }

    function readLongStore() {
        try {
            var raw = window.localStorage.getItem(LONG_STORE_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
        } catch (e) {
            return [];
        }
    }

    function writeLongStore(list) {
        try {
            window.localStorage.setItem(LONG_STORE_KEY, JSON.stringify(list));
        } catch (e) {
            // localStorage may be unavailable or full - the worker still enforces.
        }
    }

    function recentLongEntries(now) {
        var list = readLongStore();
        var fresh = [];
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            if (!entry || typeof entry.t !== 'number' || !entry.h) continue;
            if (now - entry.t < LONG_WINDOW_MS && now - entry.t >= 0) fresh.push(entry);
        }
        return fresh;
    }

    /**
     * Check a message before sending it.
     * @returns {{blocked: boolean, message?: string, retryAfter?: number}}
     */
    window.rekindleChatSpamCheck = function (text) {
        if (!text) return { blocked: false };
        var now = Date.now();
        var entries = recentEntries(now);
        var normalized = normalizeForDedupe(text);
        var shape = chatTextShapes(text);
        var i;

        // Substantial-message duplicate ring: exact text or the same token set
        // (stretched/reordered repeats) within ten minutes. This is what stops
        // a long paste being repeated with other lines in between - the four
        // short shape slots would have evicted it by then.
        if (normalized.length >= LONG_MIN_CHARS) {
            var longHash = hashText(normalized);
            var longKey = hashText(shape.toks.join(','));
            var longEntries = recentLongEntries(now);
            for (i = 0; i < longEntries.length; i++) {
                var longEntry = longEntries[i];
                if (longEntry.h === longHash || (longEntry.k && longEntry.k === longKey)) {
                    var longAge = now - longEntry.t;
                    return {
                        blocked: true,
                        retryAfter: Math.ceil((LONG_WINDOW_MS - longAge) / 1000),
                        message: translate('kindlechat.spam.duplicate', MSG_DUPLICATE)
                    };
                }
            }
        }

        for (i = 0; i < entries.length; i++) {
            var dupAge = now - entries[i].t;
            if (normalized && entries[i].h === hashText(normalized) && dupAge < DUP_WINDOW_MS) {
                return {
                    blocked: true,
                    retryAfter: Math.ceil((DUP_WINDOW_MS - dupAge) / 1000),
                    message: translate('kindlechat.spam.duplicate', MSG_DUPLICATE)
                };
            }
        }

        if (shape.toks.length) {
            var ages = [];
            for (i = 0; i < entries.length; i++) {
                if (!entries[i].k) continue;
                if (shapesMatch(shape, entries[i])) ages.push(now - entries[i].t);
            }
            if (ages.length >= REPEAT_LIMIT) {
                ages.sort(function (a, b) { return a - b; });
                var wait = Math.max(10, Math.ceil((REPEAT_WINDOW_MS - ages[REPEAT_LIMIT - 1]) / 1000));
                return {
                    blocked: true,
                    retryAfter: wait,
                    message: translate('kindlechat.spam.repeat', MSG_REPEAT)
                };
            }
        }

        return { blocked: false };
    };

    /**
     * Remember a successfully sent message so the next repeat is caught here.
     */
    window.rekindleRecordChatMessage = function (text) {
        if (!text) return;
        var now = Date.now();
        var normalized = normalizeForDedupe(text);
        var shape = chatTextShapes(text);
        var entry = {
            t: now,
            h: hashText(normalized),
            d: shape.dom,
            k: shape.toks.join(' ')
        };
        var list = [entry].concat(recentEntries(now)).slice(0, MAX_ENTRIES);
        writeStore(list);

        if (normalized.length >= LONG_MIN_CHARS) {
            var longEntry = {
                t: now,
                h: hashText(normalized),
                k: hashText(shape.toks.join(','))
            };
            var longList = [longEntry].concat(recentLongEntries(now)).slice(0, LONG_MAX_ENTRIES);
            writeLongStore(longList);
        }
    };
})();
