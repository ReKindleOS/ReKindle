/*
 * Locale integrity check.
 *
 * Run: node scripts/test-locales.js
 *
 * Guards the multilingual surface as languages are added:
 *   1. every locale file belongs to the registry and to SHIPPED (no orphans);
 *   2. every SHIPPED language has locales/<code>.json and
 *      locales/privacy-<code>.json;
 *   3. no translation invents keys, empties values, or drops a ${placeholder}
 *      that the English string interpolates (the 2026-11 `de` AO3 bug);
 *   4. every country -> language target in the registry exists.
 *
 * Missing keys are allowed and reported: js/i18n.js deliberately falls back to
 * the English markup per key, so a language can ship while new English strings
 * are still being translated. Run this after adding a language and before a
 * release; CI runs it as part of `npm test`.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const localesDir = path.join(root, 'locales');
const registry = require(path.join(root, 'js', 'i18n.js'));

const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
const privacyEn = JSON.parse(fs.readFileSync(path.join(localesDir, 'privacy-en.json'), 'utf8'));

const problems = [];
const report = [];

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
    } catch (e) {
        problems.push(file + ': invalid JSON — ' + e.message);
        return null;
    }
}

function placeholders(value) {
    const matches = String(value).match(/\$\{[^}]+\}/g) || [];
    return matches.slice().sort();
}

function checkFile(file, english, label) {
    const data = readJson(file);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const englishKeys = Object.keys(english);
    const keys = Object.keys(data);
    let missing = 0;

    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(english, key)) {
            problems.push(file + ': key "' + key + '" does not exist in ' + (label || 'en.json'));
        }
    }

    for (const key of englishKeys) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
            missing++;
            continue;
        }
        const value = data[key];
        if (typeof value !== 'string' || !value.trim()) {
            problems.push(file + ': key "' + key + '" is empty or not a string');
            continue;
        }
        const expected = placeholders(english[key]);
        const actual = placeholders(value);
        if (expected.join('|') !== actual.join('|')) {
            problems.push(file + ': key "' + key + '" placeholders [' + actual.join(', ') +
                '] do not match ' + (label || 'en.json') + ' [' + expected.join(', ') + ']');
        }
    }

    return { keys: keys.length, missing: missing, total: englishKeys.length };
}

function main() {
    const files = fs.readdirSync(localesDir).filter(function (f) {
        return f.endsWith('.json') && f.indexOf('privacy-') !== 0;
    });

    // Registry sanity: codes are unique and every country target exists.
    const seen = {};
    for (const meta of registry.list) {
        assert.ok(meta.code && meta.native, 'registry entry without code/native');
        assert.ok(!seen[meta.code], 'duplicate registry code: ' + meta.code);
        seen[meta.code] = true;
        assert.ok(meta.dir === 'ltr' || meta.dir === 'rtl', 'bad direction for ' + meta.code);
    }
    for (const cc of Object.keys(registry.countries)) {
        const lang = registry.countries[cc];
        assert.ok(seen[lang], 'country ' + cc + ' points at unknown language ' + lang);
    }

    // SHIPPED must be unique and must have its UI locale file. A privacy
    // translation is optional: the English policy is the authoritative legal
    // text, so a machine-translated UI may ship before a speaker reviews the
    // policy (privacy.html then falls back to English).
    const shipped = registry.shipped.slice();
    assert.strictEqual(new Set(shipped).size, shipped.length, 'SHIPPED contains a duplicate code');
    for (const code of shipped) {
        assert.ok(seen[code], 'SHIPPED code has no registry entry: ' + code);
        assert.ok(files.indexOf(code + '.json') !== -1, 'SHIPPED language is missing locales/' + code + '.json');
    }

    // Every locale file must be shipped; otherwise a translator can add a file
    // that no user can select and no test would notice.
    for (const file of files) {
        const code = file.replace(/\.json$/, '');
        if (shipped.indexOf(code) === -1) {
            problems.push(file + ': locale file exists but "' + code + '" is not in SHIPPED (js/i18n.js)');
        }
    }

    // Main files.
    for (const file of files) {
        const code = file.replace(/\.json$/, '');
        if (!seen[code]) {
            problems.push(file + ': language "' + code + '" is not in the js/i18n.js registry');
        }
        const stats = checkFile(file, en, 'en.json');
        if (stats) {
            report.push({
                code: code,
                keys: stats.keys,
                missing: stats.missing,
                total: stats.total,
                privacy: fs.existsSync(path.join(localesDir, 'privacy-' + code + '.json'))
            });
        }
    }

    // Privacy files.
    const privacyFiles = fs.readdirSync(localesDir).filter(function (f) {
        return f.endsWith('.json') && f.indexOf('privacy-') === 0;
    });
    for (const file of privacyFiles) {
        const code = file.replace(/^privacy-/, '').replace(/\.json$/, '');
        if (shipped.indexOf(code) === -1) {
            problems.push(file + ': privacy locale exists but "' + code + '" is not in SHIPPED');
        }
        checkFile(file, privacyEn, 'privacy-en.json');
    }

    if (problems.length) {
        console.error('FAIL - ' + problems.length + ' locale problem(s):');
        for (const p of problems) console.error('  ' + p);
        process.exit(1);
    }

    report.sort(function (a, b) { return a.code.localeCompare(b.code); });
    console.log('PASS - locale integrity (' + files.length + ' languages, ' + shipped.length + ' shipped)');
    for (const r of report) {
        console.log('  ' + r.code.padEnd(8) + ' ' + String(r.keys).padStart(5) + '/' +
            String(r.total).padEnd(5) + ' keys' +
            (r.missing ? '  (' + r.missing + ' missing, English fallback)' : '  (complete)') +
            (r.privacy ? '' : '  [privacy: English fallback]'));
    }
}

main();
