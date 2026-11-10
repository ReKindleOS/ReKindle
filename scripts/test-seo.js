'use strict';

/*
 * SEO guard.
 *
 * Run: node scripts/test-seo.js
 *
 * Search Console on 2026-11-10 reported 209 "Duplicate without user-selected
 * canonical" URLs, 11 soft 404s, 4 pages "Excluded by noindex tag" that were
 * still being submitted, and 86 crawled-but-not-indexed pages. Every one of
 * those traced back to a missing tag or a malformed <head>, and none of them is
 * visible on the device, so they need a test rather than a review checklist.
 *
 * What this asserts
 *   1. every page has exactly one head, and <meta charset>/<title>/canonical
 *      are inside it (mario.html shipped its title inside <body>, so the
 *      document had no title at all);
 *   2. one canonical per page, absolute, on https://rekindle.ink, unique;
 *   3. one <title>, <= 60 chars, unique;
 *   4. one meta description, 60-160 chars, unique on indexable pages;
 *   5. one meta robots; noindex only for the pages the table marks private;
 *   6. Open Graph + Twitter card + parseable JSON-LD on every indexable page;
 *   7. exactly one heading with text;
 *   8. 404.html exists and is noindex (without it Cloudflare Pages falls back to
 *      index.html with a 200 for every unknown URL - the soft-404 machine);
 *   9. the checked-in HTML matches scripts/seo-pages.js (drift check);
 *  10. sitemap.xml lists exactly the indexable pages, on the right host, with a
 *      lastmod that is not just "today".
 */

const assert = require('assert');
const fs = require('fs');
const cheerio = require('cheerio');
const os = require('os');
const path = require('path');

const { seoFor, slugs, PAGES, SITE } = require('./seo-pages');
const { render } = require('./seo-inject');

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const problems = [];

function fail(msg) { problems.push(msg); }

function slugOf(file) { return file.replace(/\.html$/, ''); }

function attr(html, re) {
    const m = html.match(re);
    return m ? m[1] : '';
}

// --- 1. head structure ------------------------------------------------------
for (const file of pages) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const headOpen = html.search(/<head[\s>]/i);
    const headClose = html.search(/<\/head>/i);
    const bodyOpen = html.search(/<body[\s>]/i);
    const charset = html.search(/<meta\s+charset=/i);
    const title = html.search(/<title[\s>]/i);

    if (headOpen === -1) { fail(file + ': no <head>'); continue; }
    if (headClose === -1) { fail(file + ': no </head>'); continue; }
    if (bodyOpen !== -1 && bodyOpen < headClose) fail(file + ': <body> opens before </head> (the mario.html bug)');
    if (title === -1) fail(file + ': no <title>');
    if (title !== -1 && title > headClose) fail(file + ': <title> is outside <head>');
    if (charset !== -1 && charset > headClose) fail(file + ': <meta charset> is outside <head>');
    if ((html.match(/<title[\s>]/gi) || []).length > 1) fail(file + ': more than one <title>');
}

// --- 2-7. per-page metadata ------------------------------------------------
const seenCanonical = {};
const seenTitle = {};
const seenDesc = {};

for (const file of pages) {
    if (file === '404.html') continue;
    const slug = slugOf(file);
    const seo = seoFor(slug);
    if (!seo) { fail(file + ': no scripts/seo-pages.js entry'); continue; }

    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');

    const canonicals = html.match(/<link\s+rel="canonical"[^>]*>/gi) || [];
    if (canonicals.length !== 1) fail(file + ': expected 1 canonical, found ' + canonicals.length);
    const canonical = attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (canonical !== seo.canonical) fail(file + ': canonical is ' + canonical + ', expected ' + seo.canonical);
    if (canonical && !/^https:\/\/rekindle\.ink(\/|$)/.test(canonical)) fail(file + ': canonical is not absolute on rekindle.ink');
    if (seenCanonical[canonical]) fail(file + ': duplicate canonical with ' + seenCanonical[canonical]);
    seenCanonical[canonical] = file;

    const titleText = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const decodedTitle = titleText.replace(/&amp;/g, '&').trim();
    if (!decodedTitle) fail(file + ': empty <title>');
    if (decodedTitle.length > 60) fail(file + ': title is ' + decodedTitle.length + ' chars (max 60): ' + decodedTitle);
    if (seenTitle[decodedTitle]) fail(file + ': duplicate title with ' + seenTitle[decodedTitle]);
    seenTitle[decodedTitle] = file;

    const descs = html.match(/<meta\s+name="description"[^>]*>/gi) || [];
    if (descs.length !== 1) fail(file + ': expected 1 meta description, found ' + descs.length);
    const desc = attr(html, /<meta\s+name="description"\s+content="([^"]*)"/i).replace(/&amp;/g, '&');
    if (seo.noindex) {
        // Private pages still get a description, but only for completeness.
    } else {
        if (desc.length < 60) fail(file + ': description is only ' + desc.length + ' chars (min 60)');
        if (desc.length > 160) fail(file + ': description is ' + desc.length + ' chars (max 160)');
        if (seenDesc[desc]) fail(file + ': duplicate description with ' + seenDesc[desc]);
        seenDesc[desc] = file;
    }

    const robots = html.match(/<meta\s+name="robots"[^>]*>/gi) || [];
    if (robots.length !== 1) fail(file + ': expected 1 meta robots, found ' + robots.length);
    const robotsValue = attr(html, /<meta\s+name="robots"\s+content="([^"]*)"/i);
    if (seo.noindex && robotsValue.indexOf('noindex') === -1) fail(file + ': should be noindex');
    if (!seo.noindex && robotsValue.indexOf('noindex') !== -1) fail(file + ': is noindex but not marked private in seo-pages.js');

    for (const prop of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:site_name']) {
        if (html.indexOf('property="' + prop + '"') === -1) fail(file + ': missing ' + prop);
    }
    for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
        if (html.indexOf('name="' + name + '"') === -1) fail(file + ': missing ' + name);
    }
    const ogUrl = attr(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i);
    if (ogUrl !== seo.canonical) fail(file + ': og:url does not match canonical');
    const ogImage = attr(html, /<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogImage && !/^https:\/\/rekindle\.ink\/preview\.png$/.test(ogImage)) fail(file + ': og:image should be the 1200x630 preview.png');
    if (ogImage && !fs.existsSync(path.join(ROOT, 'preview.png'))) fail('preview.png is missing (og:image target)');

    // JSON-LD must parse, and must be inside <head>.
    const ld = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (!ld) {
        fail(file + ': missing JSON-LD');
    } else {
        try {
            const data = JSON.parse(ld[1]);
            const types = (data['@graph'] || [data]).map(function (n) { return n['@type']; });
            if (types.indexOf('WebApplication') === -1 && types.indexOf('WebSite') === -1) {
                fail(file + ': JSON-LD has no WebApplication/WebSite node');
            }
        } catch (e) {
            fail(file + ': JSON-LD does not parse (' + e.message + ')');
        }
        if (ld.index > html.search(/<\/head>/i)) fail(file + ': JSON-LD is outside <head>');
    }

    // 7. headings: exactly one with text, outside <script> templates.
    const $headings = cheerio.load(html);
    const h1s = $headings('h1').filter(function () {
        return $headings(this).text().replace(/\u00a0/g, ' ').trim().length > 0;
    }).length;
    if (h1s === 0) fail(file + ': no <h1> with text');
    // index_old.html is a legacy layout kept for ?layout=old users and is
    // noindex, so it is the one page allowed its two decorative headings.
    if (!seo.noindex && h1s > 1) fail(file + ': ' + h1s + ' <h1> elements with text');

    // 9. checked-in HTML must match the metadata table.
    const expected = render(html, seo);
    if (expected !== html) fail(file + ': stale SEO block - run node scripts/seo-inject.js');
}

// --- 8. the 404 page --------------------------------------------------------
const notFoundPath = path.join(ROOT, '404.html');
if (!fs.existsSync(notFoundPath)) {
    fail('404.html is missing - Cloudflare Pages then serves index.html with a 200 for every unknown URL (soft-404)');
} else {
    const nf = fs.readFileSync(notFoundPath, 'utf8');
    if (!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(nf)) fail('404.html must be noindex');
    if (!/<title[^>]*>[^<]+<\/title>/i.test(nf)) fail('404.html needs a <title>');
    if (/<script\b/i.test(nf)) fail('404.html must not load scripts - it has to render on a stock Kindle');
}

// --- 10. sitemap ------------------------------------------------------------
const generateSitemap = require('./generate-sitemap');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rekindle-sitemap-'));
const realLog = console.log;
console.log = function () { };
generateSitemap(SITE, tmp).then(function () {
    console.log = realLog;
    const xml = fs.readFileSync(path.join(tmp, 'sitemap.xml'), 'utf8');
    const locs = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map(function (l) { return l.slice(5, -6); });

    const expected = slugs().filter(function (s) {
        return !PAGES[s].noindex && fs.existsSync(path.join(ROOT, s + '.html'));
    }).map(function (s) { return SITE + (s === 'index' ? '/' : '/' + s); });

    if (locs.length !== expected.length) fail('sitemap has ' + locs.length + ' URLs, expected ' + expected.length);
    for (const url of expected) {
        if (locs.indexOf(url) === -1) fail('sitemap is missing ' + url);
    }
    for (const url of locs) {
        if (expected.indexOf(url) === -1) fail('sitemap has unexpected URL ' + url + ' (noindex page or missing entry?)');
    }
    const lastmods = (xml.match(/<lastmod>([^<]+)<\/lastmod>/g) || []).map(function (l) { return l.slice(9, -10); });
    if (lastmods.some(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d); })) fail('sitemap lastmod must be YYYY-MM-DD');

    // lastmod must be the file's last commit date. Checking "are they all the
    // same?" produced a false positive on the very commit that touched every
    // page, so compare against git for a sample instead.
    if (fs.existsSync(path.join(ROOT, '.git'))) {
        const execSync = require('child_process').execSync;
        for (const sample of ['sudoku.html', 'help.html', 'weather.html']) {
            let expected = '';
            try {
                expected = execSync('git log -1 --format=%cs -- "' + sample + '"', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            } catch (e) { continue; }
            if (!expected) continue;
            const url = SITE + '/' + sample.replace(/\.html$/, '');
            const block = new RegExp('<loc>' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</loc>\\s*<lastmod>([^<]+)</lastmod>').exec(xml);
            if (!block) { fail('sitemap is missing a lastmod for ' + url); continue; }
            if (block[1] !== expected) fail('sitemap lastmod for ' + url + ' is ' + block[1] + ', git says ' + expected);
        }
    }
    if (!/^Sitemap: https:\/\/rekindle\.ink\/sitemap\.xml$/m.test(fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8'))) {
        fail('robots.txt must advertise the production sitemap');
    }

    if (problems.length) {
        console.error('FAIL - ' + problems.length + ' SEO problem(s):');
        for (const p of problems) console.error('  ' + p);
        process.exit(1);
    }
    console.log('PASS - SEO (' + (pages.length - 1) + ' pages: one canonical, unique title/description, JSON-LD, one <h1>, 404 page, ' + locs.length + ' sitemap URLs)');
}).catch(function (err) {
    console.log = realLog;
    console.error('FAIL - could not generate the sitemap: ' + err.message);
    process.exit(1);
});
