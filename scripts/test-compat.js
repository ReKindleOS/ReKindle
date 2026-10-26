/*
 * Static compatibility audit for the Kindle/Chromium 75 target.
 *
 * Run: node scripts/test-compat.js
 *
 * This is intentionally a source-level check. CI cannot boot a Kindle, but the
 * patterns below are the ones that break layout or JS on Chromium 75.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const root = path.join(__dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));

const problems = [];
const sharedScripts = [
    'theme.js', 'icons.js', 'bad_words.js', 'time.js', 'pro-gate.js', 'icons-beta.js',
    'js/i18n.js', 'js/gamerules.js', 'js/custom-select.js', 'js/score-submit.js',
    'js/emoji-render.js', 'js/reports.js', 'js/ip-ban.js', 'js/anti-tamper.js',
    'js/age-verification.js', 'js/promo-ban.js', 'js/link-guard.js', 'js/spam-guard.js', 'emojis.js',
    'js/ui-kit.js'
];

function lineOf(text, index) {
    return text.slice(0, index).split('\n').length;
}

for (const file of files) {
    const full = path.join(root, file);
    const html = fs.readFileSync(full, 'utf8');
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const styleBlocks = [...withoutScripts.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');

    let css;
    try {
        css = postcss.parse(styleBlocks);
    } catch (e) {
        problems.push(`${file}: CSS parse error: ${e.message}`);
        continue;
    }

    css.walkRules(rule => {
        let flex = false;
        let gap = false;

        rule.walkDecls(decl => {
            const prop = decl.prop.toLowerCase();
            const value = decl.value.toLowerCase();

            if (prop === 'display' && value.includes('flex')) flex = true;
            if (prop === 'gap' || prop === 'row-gap' || prop === 'column-gap') gap = true;

            if (prop === 'aspect-ratio') {
                problems.push(`${file}:${lineOf(html, rule.source.start.offset)}: aspect-ratio is unsupported on Chromium 75 (${rule.selector})`);
            }
            if (prop === 'position' && value.includes('sticky')) {
                problems.push(`${file}:${lineOf(html, rule.source.start.offset)}: position: sticky causes e-ink checkerboarding (${rule.selector})`);
            }
            if (prop === 'inset' || prop === 'inset-inline' || prop === 'inset-block') {
                problems.push(`${file}:${lineOf(html, rule.source.start.offset)}: CSS inset shorthand is unsupported on Chromium 75 (${rule.selector})`);
            }
            if (/\b(min|max|clamp)\(/.test(value)) {
                problems.push(`${file}:${lineOf(html, rule.source.start.offset)}: CSS ${prop}: ${decl.value.trim()} uses min()/max()/clamp() (unsupported on Chromium 75)`);
            }
        });

        if (flex && gap) {
            problems.push(`${file}:${lineOf(html, rule.source.start.offset)}: flexbox gap is unsupported on Chromium 75 (${rule.selector})`);
        }
    });

    // Inline style strings created at runtime (style.cssText / style="...").
    const inlineStyleRe = /(?:style\.cssText\s*=\s*|style\s*=\s*)(['"])([\s\S]*?)\1/g;
    let styleMatch;
    while ((styleMatch = inlineStyleRe.exec(html))) {
        const cssText = styleMatch[2];
        if (/display\s*:\s*flex/i.test(cssText) && /(?:^|;)\s*(?:gap|row-gap|column-gap)\s*:/i.test(cssText)) {
            problems.push(`${file}:${lineOf(html, styleMatch.index)}: flex gap in inline styles`);
        }
        if (/\binset\s*:/i.test(cssText)) {
            problems.push(`${file}:${lineOf(html, styleMatch.index)}: CSS inset in inline styles`);
        }
    }

    // alert()/confirm()/prompt() are unsupported on Kindle. Strip comments and
    // the words inside function names such as showAlert(.
    const withoutComments = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const fn of ['alert', 'confirm', 'prompt']) {
        const re = new RegExp(`(^|[^A-Za-z0-9_.])${fn}\\s*\\(`, 'm');
        const m = re.exec(withoutComments);
        if (m) {
            problems.push(`${file}:${lineOf(html, m.index)}: native ${fn}() is unsupported on Kindle`);
        }
    }

    // Every app page carries theme.js (dark mode + scale + wallpaper). The
    // browser probe is a raw diagnostic and deliberately stays unthemed.
    if (file !== 'probe.html' && !/theme\.js\?v=\d+/.test(html)) {
        problems.push(`${file}: missing versioned theme.js (dark mode)`);
    }

    // Local script files must exist, be unique, and shared ones must be
    // versioned so edge/SW caches cannot serve last week's copy.
    const srcs = [];
    const scriptRe = /<script[^>]*\bsrc="([^"]+)"/g;
    let scriptMatch;
    while ((scriptMatch = scriptRe.exec(html))) {
        const src = scriptMatch[1];
        if (src.startsWith('http') || src.startsWith('//')) continue;
        srcs.push(src);
        const clean = src.split('?')[0];
        if (clean.startsWith('js/') || !clean.includes('/')) {
            if (!fs.existsSync(path.join(root, clean))) {
                problems.push(`${file}:${lineOf(html, scriptMatch.index)}: missing local script ${clean}`);
            }
        }
        const base = clean.replace(/^js\//, '');
        if (sharedScripts.includes(base) || sharedScripts.includes(clean)) {
            if (!/\?v=\d+/.test(src)) {
                problems.push(`${file}:${lineOf(html, scriptMatch.index)}: shared script ${src} has no ?v= cache-buster`);
            }
        }
    }
    const dupes = srcs.filter((s, i) => srcs.indexOf(s) !== i);
    if (dupes.length) {
        problems.push(`${file}: duplicate script includes: ${[...new Set(dupes)].join(', ')}`);
    }

    // Any page that calls the timezone helper must load time.js.
    if (/rekindleGetZonedDate|rekindleFormatTime|getDateInZone/.test(html) && !/src="time\.js(\?|")/.test(html)) {
        problems.push(`${file}: uses timezone helpers but does not load time.js`);
    }
}

// Service worker precache must point at real files (the './' root exception).
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const swBlock = /const ASSETS_TO_CACHE = \[([\s\S]*?)\];/.exec(sw);
if (swBlock) {
    const assets = [...swBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const asset of assets) {
        if (asset === './') continue;
        const clean = asset.replace(/^\.\//, '').split('?')[0];
        if (!fs.existsSync(path.join(root, clean))) {
            problems.push(`sw.js: precached asset missing on disk: ${asset}`);
        }
    }
}

// If a build already exists, check the generated HTML too. The build injects
// legacy layout fixes of its own, and those must obey the same Chromium 75
// rules as the source pages.
function walkHtml(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkHtml(full, out);
        else if (entry.name.endsWith('.html')) out.push(full);
    }
    return out;
}

for (const deployDir of ['_deploy/main', '_deploy/lite', '_deploy/legacy']) {
    const fullDir = path.join(root, deployDir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of walkHtml(fullDir, [])) {
        const html = fs.readFileSync(file, 'utf8');
        const rel = path.relative(root, file);
        if (/aspect-ratio\s*:/.test(html)) problems.push(`${rel}: built output contains aspect-ratio`);
        if (/position\s*:\s*sticky/.test(html)) problems.push(`${rel}: built output contains position: sticky`);
        if (/[;{"\s]inset\s*:/.test(html)) problems.push(`${rel}: built output contains CSS inset`);
        if (/data-i18n-args/.test(html)) problems.push(`${rel}: built output contains data-i18n-args`);
    }
}

if (problems.length) {
    console.error(`FAIL - ${problems.length} compatibility problem(s):`);
    problems.forEach(p => console.error('  ' + p));
    process.exit(1);
}

console.log(`PASS - compatibility audit (${files.length} pages)`);
