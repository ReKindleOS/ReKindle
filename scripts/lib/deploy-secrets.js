'use strict';
/**
 * Shared credential scanner for anything Cloudflare Pages would publish.
 *
 * Used by TWO gates so they cannot drift apart:
 *   1. build-automation.js  -> assertNoSecretsInDeploy()  (before/after the copy)
 *   2. scripts/deploy-guard.js -> `npm run deploy:beta` / `deploy:prod` / CI
 *
 * Why this exists (2026-10-19/20 incident): `npx wrangler pages deploy .`
 * published service-account.json, service-account-social.json and
 * firebase-functions/.env. The first fix was a NAME list, which missed three
 * realistic shapes (proved 2026-11-11 by planting them in a deploy tree):
 *   - a Firebase-console download named `…-firebase-adminsdk-abc123.json`
 *   - a `.env` nested deeper than the old 5-level recursion limit
 *   - a key embedded in a `.json`/`.js` file with an innocent filename
 * So the scan is recursive (no depth limit), inspects file CONTENTS for
 * high-confidence key formats, and flags symlinks (wrangler may follow one out
 * of the deploy tree and upload its target).
 *
 * Keep CONTENT_RULES high-confidence only: a false positive blocks a real
 * deploy. In particular Firebase web API keys (AIza…) are PUBLIC config and
 * must never be flagged - they ship in every page by design.
 */
const fs = require('fs');
const path = require('path');

// Directories that must never appear anywhere in a deploy tree.
const FORBIDDEN_DIRS = new Set([
    '.git', '.github', '.wrangler', 'node_modules', 'pocketbase', 'Sync',
    'firebase-functions', 'admin', 'workers', 'scripts', 'akinator-service',
    '_deploy'
]);

// Exact filenames that must never appear in a deploy tree.
const FORBIDDEN_FILES = new Map([
    ['.env', 'environment file'],
    ['.gitignore', 'repo metadata'],
    ['.npmrc', 'npm registry credentials'],
    ['.netrc', 'netrc credentials'],
    ['.htpasswd', 'password file'],
    ['.firebaserc', 'Firebase project config'],
    ['firebase.json', 'Firebase backend config'],
    ['firebase-social.json', 'Firebase backend config'],
    ['rtdb-rules.json', 'Firebase backend config'],
    ['rtdb-social-rules.json', 'Firebase backend config'],
    ['firestore.rules', 'Firebase backend config'],
    ['firestore-social.rules', 'Firebase backend config'],
    ['storage.rules', 'Firebase backend config'],
    ['wrangler.toml', 'Wrangler config'],
    ['credentials.json', 'credentials file']
]);

// Filename patterns (case-insensitive). Ordered: first match wins.
const SECRET_NAME_RULES = [
    { re: /^\.env(\..+)?$/i, reason: 'environment file' },
    { re: /^service-account.*\.(json|js|ts)$/i, reason: 'Firebase service account key' },
    { re: /adminsdk/i, reason: 'Firebase Admin SDK key' },
    { re: /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.|$)/i, reason: 'SSH private key' },
    { re: /\.(pem|key|p8|p12|pfx|jks|keystore|ppk|kdbx|gpg|asc)$/i, reason: 'key/certificate store' },
    { re: /^credentials?.*\.json$/i, reason: 'credentials file' },
    { re: /^(secrets?|private)[-_.].*\.(json|ya?ml|txt)$/i, reason: 'secrets file' },
    { re: /\.(ovpn|mobileprovision)$/i, reason: 'private credential bundle' }
];

// High-confidence SECRET formats. Never add public identifiers here
// (Firebase AIza… web keys, Stripe pk_live… publishable keys, project ids).
const CONTENT_RULES = [
    ['PEM private key block', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
    ['Google service-account key', /"type"\s*:\s*"service_account"|"private_key_id"\s*:\s*"[0-9a-f]{20,}"|"private_key"\s*:\s*"-----BEGIN/],
    ['OpenAI API key', /\bsk-(?:proj|ant-api\d{0,2}|live|test)-[A-Za-z0-9_-]{16,}/],
    ['Stripe secret key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/],
    ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{16,}/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
    ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
    ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/]
];

// Content scanning skips binary payloads and anything huge; this keeps a
// 3 x ~49 MB deploy tree scan to a couple of seconds.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|wasm|mp[34]|webm|ogg|wav|zip|gz|br|pdf|epub|mo|so|dylib)$/i;
const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const SNIFF_BYTES = 8192;

function forbiddenNameReason(name) {
    if (FORBIDDEN_FILES.has(name)) return FORBIDDEN_FILES.get(name);
    for (const rule of SECRET_NAME_RULES) {
        if (rule.re.test(name)) return rule.reason;
    }
    return null;
}

function forbiddenNames() {
    return Array.from(FORBIDDEN_FILES.keys());
}

function contentReason(absPath, size) {
    if (size > MAX_SCAN_BYTES) return null;
    if (BINARY_EXT.test(absPath)) return null;
    let head;
    try {
        const fd = fs.openSync(absPath, 'r');
        try {
            const buf = Buffer.alloc(Math.min(SNIFF_BYTES, Math.max(size, 1)));
            const read = fs.readSync(fd, buf, 0, buf.length, 0);
            head = buf.slice(0, read);
        } finally {
            fs.closeSync(fd);
        }
    } catch (_) {
        return null;
    }
    // NUL byte in the first block => binary, don't regex it.
    if (head.includes(0)) return null;

    let text;
    try {
        text = fs.readFileSync(absPath, 'utf8');
    } catch (_) {
        return null;
    }
    for (const [label, re] of CONTENT_RULES) {
        if (re.test(text)) return label;
    }
    return null;
}

/**
 * Recursively scan a directory that is about to be published.
 * @param {string} dir absolute or cwd-relative directory
 * @returns {{path: string, reason: string}[]} problems (empty = safe)
 */
function scanDeployDir(dir) {
    const root = path.resolve(dir);
    const problems = [];
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [{ path: dir, reason: 'deploy directory does not exist' }];
    }

    const stack = [''];
    while (stack.length) {
        const rel = stack.pop();
        const abs = rel ? path.join(root, rel) : root;
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch (err) {
            problems.push({ path: rel || '.', reason: 'unreadable directory (' + err.code + ')' });
            continue;
        }
        for (const entry of entries) {
            const childRel = rel ? rel + '/' + entry.name : entry.name;
            const childAbs = path.join(abs, entry.name);

            if (entry.isSymbolicLink()) {
                problems.push({ path: childRel, reason: 'symlink (may resolve outside the deploy tree)' });
                continue;
            }
            if (entry.isDirectory()) {
                if (FORBIDDEN_DIRS.has(entry.name)) {
                    problems.push({ path: childRel + '/', reason: 'backend/checkout directory' });
                } else {
                    stack.push(childRel);
                }
                continue;
            }
            if (!entry.isFile()) continue;

            const nameReason = forbiddenNameReason(entry.name);
            if (nameReason) {
                problems.push({ path: childRel, reason: nameReason });
                continue;
            }
            let size = 0;
            try { size = fs.statSync(childAbs).size; } catch (_) { continue; }
            const reason = contentReason(childAbs, size);
            if (reason) problems.push({ path: childRel, reason: reason });
        }
    }
    return problems;
}

function formatProblems(problems, limit) {
    const max = limit || 40;
    const lines = problems.slice(0, max).map(p => p.path + '  [' + p.reason + ']');
    if (problems.length > max) lines.push('...and ' + (problems.length - max) + ' more');
    return lines.join('\n  ');
}

module.exports = {
    FORBIDDEN_DIRS,
    FORBIDDEN_FILES,
    SECRET_NAME_RULES,
    CONTENT_RULES,
    forbiddenNameReason,
    forbiddenNames,
    scanDeployDir,
    formatProblems
};
