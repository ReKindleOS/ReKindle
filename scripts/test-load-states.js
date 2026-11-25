/*
 * Loading-skeleton check.
 *
 * Run: node scripts/test-load-states.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pages = ['wordle', 'maps', 'crossword'];
for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8');
    assert.ok(html.indexOf('css/loading.css?v=1') !== -1, page + ' must load loading.css');
    assert.ok(html.indexOf('data-rk-boot') !== -1, page + ' must mark a boot skeleton');
    assert.ok((html.indexOf('rk-skeleton') !== -1 || html.indexOf('rk-skel-cell') !== -1), page + ' must contain skeleton markup');
    assert.ok(html.indexOf('rk-skel-status') !== -1, page + ' must include the screen-reader loading status');
}
const css = fs.readFileSync(path.join(ROOT, 'css', 'loading.css'), 'utf8');
assert.ok(css.indexOf('animation:') === -1, 'loading skeleton must not animate');
assert.ok(css.indexOf('transition:') === -1, 'loading skeleton must not transition');
console.log('PASS - loading states (' + pages.length + ' pages)');
