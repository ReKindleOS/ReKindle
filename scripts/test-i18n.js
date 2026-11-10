/*
 * i18n regression checks.
 *
 * Run: node scripts/test-i18n.js
 *
 * Guards the two failure modes documented in AGENTS.md:
 *   1. a `data-i18n` attribute pointing at a locale template containing ${...}
 *      (the loader cannot interpolate it)
 *   2. a literal `window.t('key')` call with no English fallback, or a
 *      `window.t('key', {vars})` call that passes the vars object as the
 *      fallback argument.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const babel = require('@babel/core');

const root = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
const privacyEn = JSON.parse(fs.readFileSync(path.join(root, 'locales/privacy-en.json'), 'utf8'));
const allKeys = new Set(Object.keys(en).concat(Object.keys(privacyEn)));
const placeholderKeys = new Set(Object.keys(en).filter(k => typeof en[k] === 'string' && en[k].includes('${')));

const problems = [];
const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html'));

function parse(code, filename) {
    try {
        return babel.parseSync(code, {
            sourceType: 'script',
            configFile: false,
            babelrc: false,
            parserOpts: {
                allowReturnOutsideFunction: true,
                allowAwaitOutsideFunction: true
            }
        });
    } catch (e) {
        problems.push(`${filename}: inline script parse error: ${e.message}`);
        return null;
    }
}

function checkTCalls(code, filename) {
    const ast = parse(code, filename);
    if (!ast) return;

    babel.traverse(ast, {
        CallExpression(p) {
            const node = p.node;
            if (!node.callee || node.callee.type !== 'MemberExpression') return;
            if (node.callee.object.type !== 'Identifier' || node.callee.object.name !== 'window') return;
            if (node.callee.property.type !== 'Identifier' || node.callee.property.name !== 't') return;
            if (!node.arguments.length) return;

            const first = node.arguments[0];
            if (first.type !== 'StringLiteral') return;

            if (node.arguments.length === 1) {
                problems.push(`${filename}: window.t('${first.value}') has no English fallback`);
            } else if (node.arguments.length === 2 && node.arguments[1].type === 'ObjectExpression') {
                problems.push(`${filename}: window.t('${first.value}', { ... }) must use window.tFormat`);
            }
        }
    });
}

for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');

    // Scan static markup only; JS template strings are checked separately.
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');

    const attrRe = /<[^>]+data-i18n(?:-html|-placeholder|-title)?="([^"]+)"[^>]*>/g;
    let m;
    while ((m = attrRe.exec(body))) {
        const key = m[1];
        if (key.includes('${')) continue; // runtime-built key, evaluated before insertion
        if (placeholderKeys.has(key)) {
            problems.push(`${file}: data-i18n="${key}" points at a template with \${...}`);
        }
        if (!allKeys.has(key)) {
            problems.push(`${file}: data-i18n="${key}" is missing from locales/en.json`);
        }
    }

    if (/data-i18n-args/.test(body)) {
        problems.push(`${file}: data-i18n-args is not supported by js/i18n.js`);
    }

    const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = scriptRe.exec(html))) {
        // Skip non-JS data scripts: the JSON-LD block in every page's SEO head
        // is JSON, not JavaScript, and parsing it as JS fails.
        const openTag = m[0].slice(0, m[0].indexOf('>') + 1);
        if (/\btype="(?!text\/javascript|application\/javascript|module)/i.test(openTag)) continue;
        if (m[1].trim()) checkTCalls(m[1], file);
    }
}

for (const file of ['js/gamerules.js', 'mario_assets/js/game.js']) {
    checkTCalls(fs.readFileSync(path.join(root, file), 'utf8'), file);
}

// Behaviour test for window.tFormat: run js/i18n.js in a small DOM stub.
const sandbox = {
    console,
    URLSearchParams,
    Promise,
    setTimeout: function () { },
    fetch: function () { return new Promise(function () { }); },
    CustomEvent: function () { },
    MutationObserver: function () { this.observe = function () { }; },
    localStorage: {
        getItem: function (key) { return key === 'rekindle_language' ? 'en' : null; },
        setItem: function () { }
    },
    navigator: { language: 'en-US' },
    location: { search: '' },
    document: {
        currentScript: { getAttribute: function () { return null; } },
        querySelector: function () { return null; },
        addEventListener: function () { },
        dispatchEvent: function () { },
        documentElement: {},
        body: { classList: { add: function () { } } }
    }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/i18n.js'), 'utf8'), sandbox, { filename: 'js/i18n.js' });

assert.strictEqual(typeof sandbox.tFormat, 'function', 'window.tFormat must be defined');
sandbox.rekindleTranslations = {
    'moves': 'Moves: ${n}',
    'pair': '${a}/${b}',
    'dollar': 'Value: ${v}'
};
assert.strictEqual(sandbox.tFormat('moves', { n: 3 }, 'Moves: ${n}'), 'Moves: 3');
assert.strictEqual(sandbox.tFormat('pair', { a: 'x', b: 'y' }, '${a}/${b}'), 'x/y');
assert.strictEqual(sandbox.tFormat('missing', { n: 1 }, 'Missing ${n}'), 'Missing 1');
assert.strictEqual(sandbox.tFormat('dollar', { v: '$&' }, 'Value: ${v}'), 'Value: $&');

if (problems.length) {
    console.error(`FAIL - ${problems.length} i18n problem(s):`);
    problems.forEach(p => console.error('  ' + p));
    process.exit(1);
}

console.log(`PASS - i18n audit (${htmlFiles.length} pages, ${allKeys.size} keys)`);
