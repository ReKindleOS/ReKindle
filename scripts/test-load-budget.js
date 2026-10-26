/*
 * Load-budget and cache-safety audit for the Kindle target.
 *
 * Run: node scripts/test-load-budget.js
 *
 * Why this exists (2026-10-26 load-path pass): `_headers` now serves every
 * `?v=`-versioned asset with `max-age=31536000, immutable` and the service
 * worker serves those URLs cache-first. Both are only safe while two rules
 * hold, and both have silently broken before:
 *
 *   1. every local script/stylesheet reference carries `?v=N` — otherwise a
 *      year-long browser cache (and the SW) freezes the old bytes;
 *   2. nothing third-party blocks the parser unless it is a known, needed
 *      library — a blocking analytics tag is what counter.dev was.
 *
 * It also prints a per-page budget so a change that adds 100 KB to a page is
 * visible in CI logs, not discovered on a device.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));

// Scripts that are allowed to be parser-blocking even though they are remote.
// Everything here is a library the page genuinely needs before its own script
// runs; keep the list short and never add analytics/tracking to it.
const BLOCKING_ALLOWLIST = [
    'www.gstatic.com/firebasejs/',      // Firebase compat SDKs
    'cdnjs.cloudflare.com/ajax/libs/',  // gif.js, qrcode, chess, marked
    'unpkg.com/',                       // html5-qrcode, leaflet, maplibre
    'cdn.jsdelivr.net/'                 // epub.js
];

// Local files that are deliberately unversioned (a game's own sprite/logic
// modules; the game loads them once and they are not shared between pages).
const UNVERSIONED_ALLOWLIST = [
    'mario_assets/'
];

const problems = [];
const budgets = [];

function gzipSize(file) {
    try {
        return zlib.gzipSync(fs.readFileSync(file)).length;
    } catch (e) {
        return 0;
    }
}

const sizeCache = {};
function localSize(src) {
    const clean = decodeURIComponent(src.split('?')[0]);
    if (sizeCache[clean] !== undefined) return sizeCache[clean];
    let bytes = 0;
    try {
        bytes = gzipSize(path.join(root, clean));
    } catch (e) {
        bytes = 0;
    }
    sizeCache[clean] = bytes;
    return bytes;
}

const scriptRe = /<script\b([^>]*)>/gi;
const linkRe = /<link\b([^>]*)>/gi;
const srcRe = /\bsrc="([^"]+)"/i;
const hrefRe = /\bhref="([^"]+)"/i;
const relRe = /\brel="([^"]+)"/i;

for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const bodyIndex = html.indexOf('<body');
    let budgetBytes = gzipSize(path.join(root, page));
    let requests = 1;
    let blocking = 0;
    let blockingInHead = 0;

    // --- scripts ---------------------------------------------------------
    for (const match of html.matchAll(scriptRe)) {
        const attrs = match[1];
        const srcMatch = attrs.match(srcRe);
        if (!srcMatch) continue;
        const src = srcMatch[1];
        requests++;

        const isLocal = !/^(https?:)?\/\//i.test(src);
        const isBlocking = !/\bdefer\b/i.test(attrs) && !/\basync\b/i.test(attrs);
        if (isBlocking) {
            blocking++;
            // A parser-blocking script in <head> delays the first paint; the same
            // tag at the end of <body> (after the markup) does not. Report them
            // separately so the budget stays honest.
            if (bodyIndex === -1 || match.index < bodyIndex) blockingInHead++;
        }

        if (isLocal) {
            budgetBytes += localSize(src);
            const allowlisted = UNVERSIONED_ALLOWLIST.some(prefix => src.indexOf(prefix) !== -1);
            if (!/\?v=\d+/.test(src) && !allowlisted) {
                problems.push(page + ': local script has no ?v= — ' + src);
            }
        } else if (isBlocking) {
            const allowed = BLOCKING_ALLOWLIST.some(prefix => src.indexOf(prefix) !== -1);
            if (!allowed) {
                problems.push(page + ': third-party script blocks the parser — ' + src);
            }
        }
    }

    // --- stylesheets -----------------------------------------------------
    for (const match of html.matchAll(linkRe)) {
        const attrs = match[1];
        const hrefMatch = attrs.match(hrefRe);
        if (!hrefMatch) continue;
        const rel = (attrs.match(relRe) || [])[1] || '';
        if (rel.toLowerCase().indexOf('stylesheet') === -1) continue;
        const href = hrefMatch[1];
        requests++;
        const isLocal = !/^(https?:)?\/\//i.test(href);
        if (isLocal) {
            budgetBytes += localSize(href);
            if (!/\?v=\d+/.test(href) && !/data:/.test(href)) {
                problems.push(page + ': local stylesheet has no ?v= — ' + href);
            }
        }
    }

    budgets.push({ page, requests, kb: Math.round(budgetBytes / 1024), blocking, blockingInHead });
}

// --- _headers must keep the immutable rules and their detach overrides -----
const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
assert.ok(/\/\*\.js[\s\S]{0,120}?max-age=31536000, immutable/.test(headers),
    '_headers must cache versioned JS immutably');
assert.ok(/\/\*\.css[\s\S]{0,120}?max-age=31536000, immutable/.test(headers),
    '_headers must cache versioned CSS immutably');
const swBlock = headers.match(/\/sw\.js\n([\s\S]*?)(\n\n|$)/);
assert.ok(swBlock && /! Cache-Control/.test(swBlock[1]) && /no-cache/.test(swBlock[1]),
    '/sw.js must detach the immutable rule and stay no-cache');
const marioBlock = headers.match(/\/mario_assets\/\*\n([\s\S]*?)(\n\n|$)/);
assert.ok(marioBlock && /! Cache-Control/.test(marioBlock[1]),
    '/mario_assets/* must detach the immutable rule (those files are unversioned)');

// --- success ---------------------------------------------------------------
if (problems.length) {
    console.error('FAIL - ' + problems.length + ' load-budget problem(s):');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
}

budgets.sort((a, b) => b.kb - a.kb);
console.log('PASS - load budget (' + pages.length + ' pages, all local assets versioned, no unknown blocking third-party scripts)');
console.log('  heaviest pages (compressed HTML + local JS/CSS):');
for (const b of budgets.slice(0, 10)) {
    console.log('    ' + b.page.padEnd(22) + String(b.kb).padStart(5) + ' KB  ' +
        String(b.requests).padStart(3) + ' requests  ' + String(b.blockingInHead).padStart(2) + ' blocking in <head> / ' + b.blocking + ' total');
}
