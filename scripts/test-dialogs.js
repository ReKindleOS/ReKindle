/*
 * Shared dialog chrome check.
 *
 * Run: node scripts/test-dialogs.js
 *
 * The runtime normalizer only handles static modals with a heading. Every page
 * that has such a modal must load the shared stylesheet and the normalizer so
 * the System 7 title bar actually appears.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
let eligible = 0;
let pagesWithEligible = 0;
const missing = [];

for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    if (html.indexOf('modal-box') === -1) continue;
    const $ = cheerio.load(html);
    let hasEligible = false;
    $('.modal-box').each((i, el) => {
        const $el = $(el);
        if ($el.hasClass('rk-dialog') || $el.hasClass('window-style')) return;
        const first = $el.children().first();
        const tag = (first[0] && first[0].tagName || '').toUpperCase();
        const cls = String(first.attr('class') || '');
        if (tag === 'H2' || tag === 'H3' || (tag === 'DIV' && cls.indexOf('modal-title') !== -1)) {
            eligible++;
            hasEligible = true;
        }
    });
    if (!hasEligible) continue;
    pagesWithEligible++;
    if (html.indexOf('js/system-dialog.css') === -1) missing.push(page + ': system-dialog.css');
    if (html.indexOf('js/dialog-enhance.js') === -1) missing.push(page + ': dialog-enhance.js');
}

assert.ok(eligible >= 100, 'expected at least 100 eligible dialogs, found ' + eligible);
assert.strictEqual(missing.length, 0, 'missing dialog assets:\n  ' + missing.join('\n  '));

// No stylesheet link may be inserted inside a <style> block (this bit a JS
// document.write string in index.html once).
for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const styleBlocks = html.match(/<style[\s\S]*?<\/style>/gi) || [];
    for (const block of styleBlocks) {
        assert.ok(block.indexOf('<link') === -1, page + ': <link> inside <style>');
    }
}

const css = fs.readFileSync(path.join(ROOT, 'js', 'system-dialog.css'), 'utf8');
assert.ok(/\.rk-dialog-bar/.test(css) && /\.rk-dialog-title/.test(css), 'shared dialog CSS must define the title bar');
assert.ok(/!important/.test(css), 'shared dialog CSS must reset page heading styles');

console.log('PASS - dialogs (' + eligible + ' eligible modals on ' + pagesWithEligible + ' pages)');
