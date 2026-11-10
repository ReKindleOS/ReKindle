#!/usr/bin/env node
/*
 * Generate locales/<code>.json from locales/en.json.
 *
 *   node scripts/translate-locales.js tr ar tl hi nl
 *   node scripts/translate-locales.js tr --force
 *   node scripts/translate-locales.js tl --individual   # one request per string
 *
 * WHY THIS EXISTS
 * ---------------
 * UI translations were hand-written. This script fills a new language from the
 * English source, batching several strings per POST. Output is UNREVIEWED
 * machine translation: ship it behind the existing BETA language badge and
 * have a speaker review it.
 *
 * Providers:
 *   - default `bing` uses Bing's ttranslatev3 endpoint (LLM-backed, ~900 chars
 *     per POST, auth params parsed from /translator and refreshed on error);
 *   - `--google` uses gtx (~3,000 chars per POST). It is faster when it is not
 *     CAPTCHA-blocking the IP, which is why it is not the default.
 *
 * SAFETY RULES
 * ------------
 * - ${placeholders} and {{tokens}} are replaced with __RKPHn__ tokens before
 *   translation and restored afterwards. Google translates bare ${name}
 *   (it becomes ${الاسم} in Arabic), which the tFormat contract forbids.
 * - Internal newlines are tokenised so one locale value can never look like a
 *   batch separator.
 * - Every value is re-checked for placeholder parity, HTML tag/href parity,
 *   empty output and leftover tokens. A failed value falls back to English and
 *   is counted in the summary; the file is still written.
 * - 429/5xx/network errors retry with exponential backoff. A bot-block page
 *   aborts the run (rerun later; existing language files are skipped).
 *
 * Both endpoints are unofficial. Do not wire them into the app or `npm test`; this
 * is a development-time generator only. Keep `locales/en.json` as the source
 * and rerun after English strings change.
 *
 * Usage notes:
 * - `zh-Hant` is sent to Google as `zh-TW` and to Bing as `zh-Hant`.
 * - `tl` is sent to Bing as `fil`; `no` as `nb`; `sr` as `sr-Cyrl`.
 * - Privacy policies are NOT generated: the English text is the authoritative
 *   legal version, and privacy.html falls back to it until a speaker reviews a
 *   translated policy.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const localesDir = path.join(root, 'locales');
const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const BING_PAGE = 'https://www.bing.com/translator';
const BING_ENDPOINT = 'https://www.bing.com/ttranslatev3?isVertical=1';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

// Google's gtx endpoint accepts ~3,000 chars per POST but regularly blocks the
// shared IP with a CAPTCHA after a burst. Bing's ttranslatev3 uses an LLM,
// accepts ~900 chars per POST, and has been the more reliable bulk provider.
const GOOGLE_TARGET = { 'zh-Hant': 'zh-TW' };
const BING_TARGET = { 'zh-Hant': 'zh-Hant', tl: 'fil', no: 'nb', sr: 'sr-Cyrl' };

const args = process.argv.slice(2);
const force = args.indexOf('--force') !== -1;
const useGoogle = args.indexOf('--google') !== -1;
const individual = args.indexOf('--individual') !== -1;
const repair = args.indexOf('--repair') !== -1;
const missingOnly = args.indexOf('--missing') !== -1;
const privacyMode = args.indexOf('--privacy') !== -1;
const provider = useGoogle ? 'google' : 'bing';
const BATCH_CHARS = useGoogle ? 2600 : 800;
const MARKER_OVERHEAD = 18;
// Bing's LLM starts leaving strings in English above ~10 entries per request.
const MAX_BATCH_ENTRIES = useGoogle ? 40 : 10;
const DELAY_MS = useGoogle ? 180 : 120;
const CONCURRENCY = useGoogle ? 1 : 32;
const MAX_ATTEMPTS = 5;
const codes = args.filter(function (arg) { return arg.charAt(0) !== '-'; });

if (!codes.length) {
    console.error('usage: node scripts/translate-locales.js <code> [<code> ...] [--force] [--missing] [--privacy] [--google] [--individual] [--repair]');
    console.error('example: node scripts/translate-locales.js tr ar tl hi nl ro');
    process.exit(1);
}

const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
const privacyEn = JSON.parse(fs.readFileSync(path.join(localesDir, 'privacy-en.json'), 'utf8'));
const entries = Object.keys(en).map(function (key) {
    return { key: key, value: String(en[key]) };
});

let tokenCounter = 0;

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// A hung upstream request must not pin a worker forever; every provider call
// gets a hard timeout and then goes through the normal retry path.
function fetchWithTimeout(url, options, ms) {
    const opts = Object.assign({}, options || {});
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        opts.signal = AbortSignal.timeout(ms || 30000);
    }
    return fetch(url, opts);
}

function protect(text) {
    const saved = [];
    let out = String(text);
    const token = function (value) {
        const name = '__RKPH' + (tokenCounter++) + '__';
        saved.push([name, value]);
        return name;
    };
    out = out.replace(/\$\{[^}]+\}/g, token);
    out = out.replace(/\{\{[^}]+\}\}/g, token);
    out = out.replace(/\n/g, function () { return token('\n'); });
    return { text: out, saved: saved };
}

function restore(text, saved) {
    let out = String(text);
    for (let i = 0; i < saved.length; i++) {
        out = out.split(saved[i][0]).join(saved[i][1]);
    }
    return out;
}

function placeholderSig(value) {
    return (String(value).match(/\$\{[^}]+\}/g) || []).sort().join('|');
}

function tagSig(value) {
    return (String(value).match(/<[^>]+>/g) || [])
        .map(function (tag) { return tag.replace(/\s+/g, ' ').trim(); })
        .sort()
        .join('|');
}

function hrefSig(value) {
    return (String(value).match(/href\s*=\s*['"][^'"]+['"]/gi) || [])
        .map(function (href) { return href.replace(/\s+/g, ' '); })
        .sort()
        .join('|');
}

function makeBatches(list) {
    const batches = [];
    let current = [];
    let size = 0;
    for (let i = 0; i < list.length; i++) {
        const length = list[i].protected.length + MARKER_OVERHEAD + 1;
        if (current.length && (current.length >= MAX_BATCH_ENTRIES || size + length > BATCH_CHARS)) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(list[i]);
        size += length;
    }
    if (current.length) batches.push(current);
    return batches;
}

async function googleTranslate(text, target) {
    const body = new URLSearchParams({
        client: 'gtx',
        sl: 'en',
        tl: target,
        dt: 't',
        q: text
    });

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetchWithTimeout(GOOGLE_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'User-Agent': BROWSER_UA
                },
                body: body
            });
            const raw = await res.text();
            if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (!raw.trim() || raw.trim().charAt(0) === '<') {
                throw new Error('non-JSON response (bot block?)');
            }
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data[0])) throw new Error('unexpected response shape');
            return data[0].map(function (segment) { return segment[0]; }).join('');
        } catch (e) {
            lastError = e;
            if (attempt === MAX_ATTEMPTS) break;
            const wait = 1500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
            process.stderr.write('  retry ' + attempt + '/' + MAX_ATTEMPTS + ' in ' + wait + 'ms (' + e.message + ')\n');
            await sleep(wait);
        }
    }
    throw lastError;
}

let bingAuth = null;

async function getBingAuth(force) {
    if (!force && bingAuth && Date.now() - bingAuth.time < 45 * 60 * 1000) return bingAuth;

    const res = await fetchWithTimeout(BING_PAGE, {
        headers: {
            'User-Agent': BROWSER_UA,
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    const html = await res.text();
    const ig = html.match(/IG:"([^"]+)"/);
    const abuse = html.match(/params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"/);
    if (!ig || !abuse) throw new Error('Bing auth parse failed');
    bingAuth = { ig: ig[1], key: abuse[1], token: abuse[2], time: Date.now() };
    return bingAuth;
}

async function bingTranslate(text, target) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const auth = await getBingAuth(attempt > 1);
            const url = BING_ENDPOINT + '&IG=' + encodeURIComponent(auth.ig) + '&IID=translator.5028';
            const body = new URLSearchParams({
                fromLang: 'en',
                to: target,
                text: text,
                token: auth.token,
                key: auth.key
            });
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'User-Agent': BROWSER_UA,
                    'Referer': BING_PAGE,
                    'Origin': 'https://www.bing.com'
                },
                body: body
            });
            const raw = await res.text();
            if (!raw.trim() || raw.trim().charAt(0) === '<') throw new Error('non-JSON response (bot block?)');
            const data = JSON.parse(raw);
            if (data && data[0] && data[0].translations &&
                data[0].translations[0] && typeof data[0].translations[0].text === 'string') {
                return data[0].translations[0].text;
            }
            throw new Error('Bing error ' + (data && data.statusCode ? data.statusCode : 'unexpected'));
        } catch (e) {
            lastError = e;
            if (attempt === MAX_ATTEMPTS) break;
            const wait = 1200 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
            process.stderr.write('  retry ' + attempt + '/' + MAX_ATTEMPTS + ' in ' + wait + 'ms (' + e.message + ')\n');
            await sleep(wait);
        }
    }
    throw lastError;
}

function postTranslate(text, target) {
    return provider === 'google' ? googleTranslate(text, target) : bingTranslate(text, target);
}

async function translateBatch(batch, target) {
    // Newline-separated strings are not robust: some targets merge/split lines,
    // which used to fall back to one request per string. Wrap each value in
    // unique markers instead, so the mapping survives reordering and extra
    // line breaks. Markers are stripped before validation.
    const marked = batch.map(function (entry, index) {
        return {
            start: '__RKB' + index + '__',
            end: '__RKE' + index + '__',
            text: entry.protected
        };
    });
    const joined = marked.map(function (m) { return m.start + m.text + m.end; }).join('\n');
    let raw;
    try {
        raw = await postTranslate(joined, target);
    } catch (e) {
        // A batch can 400 on one awkward value (length, punctuation, a marker
        // collision). Retry each string alone; one bad value must not abort the
        // whole language.
        const fallback = [];
        for (let i = 0; i < batch.length; i++) {
            try {
                let value = await postTranslate(batch[i].protected, target);
                value = value.replace(/\n+/g, ' ').trim();
                fallback.push(value);
            } catch (err) {
                fallback.push(batch[i].value);
            }
            await sleep(DELAY_MS);
        }
        return fallback;
    }
    const out = [];

    for (let i = 0; i < marked.length; i++) {
        const m = marked[i];
        const start = raw.indexOf(m.start);
        const end = start === -1 ? -1 : raw.indexOf(m.end, start + m.start.length);
        if (start !== -1 && end !== -1) {
            out.push(raw.slice(start + m.start.length, end));
            continue;
        }
        // A marker was lost (rare): translate only that string.
        let value = await postTranslate(batch[i].protected, target);
        value = value.replace(/\n+/g, ' ').trim();
        out.push(value);
        await sleep(DELAY_MS);
    }
    return out;
}

function acceptable(original, translated) {
    if (!translated || !translated.trim()) return false;
    if (translated.indexOf('__RKPH') !== -1) return false;
    if (placeholderSig(original) !== placeholderSig(translated)) return false;
    if (tagSig(original) !== tagSig(translated)) return false;
    if (hrefSig(original) !== hrefSig(translated)) return false;
    return true;
}


const NON_LATIN_TARGETS = {
    hi: 1, bn: 1, ta: 1, ne: 1, ur: 1, ar: 1, he: 1, th: 1, ja: 1, ko: 1,
    zh: 1, 'zh-Hant': 1, ru: 1, uk: 1, bg: 1, sr: 1, el: 1
};
const BRAND_RE = /\b(?:ReKindle\+?|KindleChat|Kindle|OpenMoji|Akinator|AirType|GitHub|Discord|Google|YouTube|Spotify|Reddit|Bluesky|Mastodon|Pinterest|Wikipedia|Gutenberg|AO3|NRL|Dropbox|Outlook|Hotmail|CalDAV|CardDAV|WebDAV|RSS|EPUB|PDF|CSV|JSON|Wi-Fi|Bluetooth|USB|KPM|Kobo|Paperwhite|System 7|Stripe|Firebase|Cloudflare|OpenAI|TMDB|IMDb|Goodreads|StoryGraph|Libby|Flipboard|Substack|Readwise)\b/gi;
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const PH_RE = /\$\{[^}]+\}|\{\{[^}]+\}\}/g;

function stripped(value) {
    return String(value)
        .replace(URL_RE, ' ')
        .replace(PH_RE, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(BRAND_RE, ' ');
}

function translatable(value) {
    return /[A-Za-z]{2,}/.test(stripped(value));
}

function hasLatinWords(value) {
    return /[A-Za-z]{3,}/.test(stripped(value));
}

const PHILIPPINE_ENGLISH_RE = /\b(?:the|and|error|loading|network|could|not|please|try|again|settings?|save|cancel|reader|language|yes|no|child|mode|access|denied|description|region|answer|score|player|game|start|back|next|search|home|help|account|library|open|close|delete|edit|share|copy|paste|download|upload)\b/i;

function suspectValue(code, original, translated) {
    if (!translated) return false;
    if (translated === original && translatable(original)) return true;
    if (NON_LATIN_TARGETS[code] && hasLatinWords(translated)) return true;
    if (code === 'tl' && PHILIPPINE_ENGLISH_RE.test(stripped(translated))) return true;
    return false;
}

async function repairLanguage(code) {
    const file = path.join(localesDir, code + '.json');
    if (!fs.existsSync(file)) throw new Error(code + ': no locale file to repair');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const target = (provider === 'google' ? GOOGLE_TARGET[code] : BING_TARGET[code]) || code;
    const suspects = [];

    for (let i = 0; i < entries.length; i++) {
        const key = entries[i].key;
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
        if (suspectValue(code, entries[i].value, data[key])) {
            suspects.push({ key: key, value: entries[i].value });
        }
    }

    console.log(code + ': repairing ' + suspects.length + ' suspect value(s)');
    let cursor = 0;
    let changed = 0;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= suspects.length) return;
            const item = suspects[index];
            try {
                const protectedValue = protect(item.value);
                const raw = await postTranslate(protectedValue.text, target);
                const value = restore(raw, protectedValue.saved).replace(/\n+/g, ' ').trim();
                if (acceptable(item.value, value) && value !== item.value) {
                    data[item.key] = value;
                    changed++;
                }
            } catch (e) {
                // Keep the existing value; a repair is best-effort.
            }
            await sleep(DELAY_MS);
        }
    }

    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);

    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(code + ': repaired ' + changed + '/' + suspects.length + ' value(s)');
}


/* ------------------------------------------------------------------ */
/*  PRIVACY POLICY TRANSLATION                                         */
/* ------------------------------------------------------------------ */

function protectPrivacy(value) {
    const saved = [];
    const token = function (v) {
        const name = '__RKPV' + saved.length + '__';
        saved.push([name, v]);
        return name;
    };
    let out = String(value);
    out = out.replace(/\$\{[^}]+\}/g, token);
    out = out.replace(/\{\{[^}]+\}\}/g, token);
    out = out.replace(/<code>[\s\S]*?<\/code>/gi, token);
    out = out.replace(/\{[^{}]+\}/g, token);
    out = out.replace(/\n/g, token);
    return { text: out, saved: saved };
}

function splitPrivacyValue(text) {
    const blocks = text.split(/(?<=<\/(?:p|li|h[1-6]|ul|ol|blockquote)>|<br\s*\/?>)/i);
    const out = [];
    for (let b = 0; b < blocks.length; b++) {
        let rest = blocks[b];
        while (rest.length > 850) {
            let cut = rest.lastIndexOf('. ', 850);
            if (cut < 300) cut = rest.lastIndexOf(' ', 850);
            if (cut < 300) cut = 850;
            out.push(rest.slice(0, cut + 1));
            rest = rest.slice(cut + 1);
        }
        if (rest.trim()) out.push(rest);
    }
    return out;
}

async function translatePrivacyLanguage(code) {
    const file = path.join(localesDir, 'privacy-' + code + '.json');
    let existing = null;
    if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, 'utf8'));

    const sourceKeys = Object.keys(privacyEn);
    let keys = sourceKeys;
    if (missingOnly && existing) {
        keys = sourceKeys.filter(function (key) { return !Object.prototype.hasOwnProperty.call(existing, key); });
        if (!keys.length) {
            console.log(code + ': privacy complete');
            return;
        }
        console.log(code + ': ' + keys.length + ' missing privacy key(s)');
    }

    const target = (provider === 'google' ? GOOGLE_TARGET[code] : BING_TARGET[code]) || code;
    const jobs = [];
    const result = existing ? Object.assign({}, existing) : {};
    let fallbacks = 0;

    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const value = String(privacyEn[key]);
        const protectedValue = protectPrivacy(value);
        const parts = splitPrivacyValue(protectedValue.text);
        result[key] = null;
        for (let p = 0; p < parts.length; p++) {
            jobs.push({ key: key, index: p, count: parts.length, text: parts[p], saved: protectedValue.saved, original: value, parts: null });
        }
        // Store the original parts count on every job; the worker writes into a
        // shared array keyed by a unique job id instead of the key (a key can
        // have several segments).
        for (let p = 0; p < parts.length; p++) {
            jobs[jobs.length - parts.length + p].id = key + '::' + p;
        }
    }

    const outputs = {};
    for (let i = 0; i < jobs.length; i++) outputs[jobs[i].id] = null;

    let cursor = 0;
    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= jobs.length) return;
            const job = jobs[index];
            try {
                const raw = await postTranslate(job.text, target);
                outputs[job.id] = restore(raw, job.saved).replace(/\n+/g, ' ').trim();
            } catch (e) {
                outputs[job.id] = null;
            }
            await sleep(DELAY_MS);
        }
    }
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);

    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const original = String(privacyEn[key]);
        const parts = jobs.filter(function (job) { return job.key === key; });
        let joined = '';
        let ok = true;
        for (let p = 0; p < parts.length; p++) {
            const value = outputs[parts[p].id];
            if (value === null) { ok = false; break; }
            joined += value;
        }
        if (ok && joined.indexOf('__RKPV') === -1 &&
            placeholderSig(original) === placeholderSig(joined) &&
            tagSig(original) === tagSig(joined) &&
            hrefSig(original) === hrefSig(joined)) {
            result[key] = joined;
        } else {
            result[key] = original;
            fallbacks++;
        }
    }

    const ordered = {};
    for (let i = 0; i < sourceKeys.length; i++) {
        ordered[sourceKeys[i]] = Object.prototype.hasOwnProperty.call(result, sourceKeys[i])
            ? result[sourceKeys[i]]
            : String(privacyEn[sourceKeys[i]]);
    }
    fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
    console.log(code + ': wrote ' + path.relative(root, file) + ' (' + fallbacks + ' English fallback(s))');
}

async function translateLanguage(code) {
    const file = path.join(localesDir, code + '.json');
    let existing = null;
    if (fs.existsSync(file)) {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    if (existing && !force && !missingOnly) {
        console.log(code + ': exists, skipping (use --force to overwrite)');
        return;
    }

    let sourceEntries = entries;
    if (missingOnly && existing) {
        sourceEntries = entries.filter(function (entry) {
            return !Object.prototype.hasOwnProperty.call(existing, entry.key);
        });
        if (!sourceEntries.length) {
            console.log(code + ': no missing keys');
            return;
        }
        console.log(code + ': ' + sourceEntries.length + ' missing key(s)');
    }

    const target = (provider === 'google' ? GOOGLE_TARGET[code] : BING_TARGET[code]) || code;
    const prepared = sourceEntries.map(function (entry) {
        const protectedValue = protect(entry.value);
        return {
            key: entry.key,
            value: entry.value,
            protected: protectedValue.text,
            saved: protectedValue.saved
        };
    });

    const batches = individual
        ? prepared.map(function (entry) { return [entry]; })
        : makeBatches(prepared);
    const translated = existing ? Object.assign({}, existing) : {};
    let fallbacks = 0;
    let requests = 0;
    const started = Date.now();

    // Bing tolerates a few parallel requests; Google's gtx endpoint 429s on
    // bursts, so it stays sequential. Fetch in parallel, validate in order so
    // placeholder/tag fallbacks still map to the right key.
    const partsByBatch = new Array(batches.length);
    let nextBatch = 0;
    let finishedBatches = 0;

    async function batchWorker() {
        while (true) {
            const index = nextBatch++;
            if (index >= batches.length) return;
            try {
                partsByBatch[index] = await translateBatch(batches[index], target);
            } catch (e) {
                throw new Error(code + ': translation aborted at batch ' +
                    (index + 1) + '/' + batches.length + ' — ' + e.message);
            }
            requests++;
            finishedBatches++;
            if (finishedBatches % 10 === 0 || finishedBatches === batches.length) {
                console.log(code + ': ' + finishedBatches + '/' + batches.length + ' batches fetches');
            }
            await sleep(DELAY_MS);
        }
    }

    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) workers.push(batchWorker());
    await Promise.all(workers);

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const parts = partsByBatch[b];

        for (let i = 0; i < batch.length; i++) {
            const entry = batch[i];
            let value = restore(parts[i], entry.saved);
            if (!acceptable(entry.value, value)) {
                // Retry that one string without batching before falling back.
                try {
                    await sleep(DELAY_MS);
                    const single = await postTranslate(entry.protected, target);
                    requests++;
                    value = restore(single, entry.saved).replace(/\n+/g, ' ').trim();
                } catch (e) {
                    value = '';
                }
            }
            if (acceptable(entry.value, value)) {
                translated[entry.key] = value;
            } else {
                translated[entry.key] = entry.value;
                fallbacks++;
            }
        }
    }
    console.log(code + ': validated ' + entries.length + ' keys, ' + fallbacks +
        ' English fallback(s), ' + requests + ' request(s)');

    // Keep the English key order so diffs stay readable.
    const ordered = {};
    for (let i = 0; i < entries.length; i++) {
        ordered[entries[i].key] = Object.prototype.hasOwnProperty.call(translated, entries[i].key)
            ? translated[entries[i].key]
            : entries[i].value;
    }
    fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
    console.log(code + ': wrote ' + path.relative(root, file) + ' (' +
        Math.round((Date.now() - started) / 1000) + 's, ' + fallbacks + ' English fallback(s))');
}

async function main() {
    for (let i = 0; i < codes.length; i++) {
        if (repair) await repairLanguage(codes[i]);
        else if (privacyMode) await translatePrivacyLanguage(codes[i]);
        else await translateLanguage(codes[i]);
    }
    console.log('done');
}

main().catch(function (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
