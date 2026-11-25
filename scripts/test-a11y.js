/*
 * Touch/typography guard for the #4 quality pass.
 *
 * Run: node scripts/test-a11y.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const targets = ['cargames', 'words', 'crossword', 'preview', 'pet', 'pixel', 'moderation', 'login', 'help', 'suggestions'];
const problems = [];

for (const page of targets) {
    const html = fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8');
    const style = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
    const re = /font-size\s*:\s*(0?\.\d+|0)\s*(rem|em)/g;
    let m;
    while ((m = re.exec(style))) {
        const value = Number(m[1]);
        if (value > 0 && value < 0.75) {
            problems.push(page + ': font-size ' + m[0] + ' is below 12px');
        }
    }
}

if (problems.length) {
    console.error('FAIL - ' + problems.length + ' a11y problem(s):');
    problems.slice(0, 40).forEach(p => console.error('  ' + p));
    process.exit(1);
}
console.log('PASS - a11y (' + targets.length + ' type pages, 12px minimum)');
