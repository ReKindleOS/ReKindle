#!/usr/bin/env node
/**
 * Deploy guard — refuses to publish a directory that contains repo credentials.
 *
 * Why this exists (2026-10-19 incident): `npx wrangler pages deploy .` uploaded
 * firebase-functions/.env, service-account.json and service-account-social.json
 * from the repo root. build-automation.js only protects `npm run build`; this
 * protects the wrangler step, including a hand-typed deploy of the wrong folder.
 *
 * Usage:
 *   node scripts/deploy-guard.js _deploy/main
 *   (then) npx wrangler pages deploy _deploy/main --project-name=rekindle --branch=main
 *
 * Only directories under _deploy/ may be published.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const target = process.argv[2];

function fail(msg) {
    console.error('\n🚨 DEPLOY BLOCKED\n' + msg + '\n');
    process.exit(1);
}

if (!target) fail('No deploy target given. Usage: node scripts/deploy-guard.js _deploy/main');

const abs = path.resolve(process.cwd(), target);
const rel = path.relative(ROOT, abs).replace(/\\/g, '/');

if (abs === ROOT || rel === '') {
    fail('Refusing to deploy the repo root — it contains .env and service-account*.json.\n' +
         'Run `npm run build` and deploy `_deploy/main` instead.');
}
if (rel.startsWith('..') || path.isAbsolute(rel)) {
    fail(`Refusing to deploy "${rel}" — the target must be inside the repository (_deploy/...).`);
}
if (!rel.startsWith('_deploy/')) {
    fail(`Refusing to deploy "${rel}". Only _deploy/<target> may be published.\n` +
         'Run `npm run build` first, then deploy _deploy/main, _deploy/lite or _deploy/legacy.');
}
if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail(`Deploy target does not exist: ${rel}`);
}

const FORBIDDEN_DIRS = new Set([
    '.git', '.github', '.wrangler', 'node_modules', 'pocketbase', 'Sync',
    'firebase-functions', 'admin', 'workers', 'scripts', 'akinator-service',
    '_deploy'
]);
const FORBIDDEN_FILES = new Set([
    '.env', '.gitignore', 'firebase.json', 'firebase-social.json',
    'rtdb-rules.json', 'rtdb-social-rules.json', 'firestore.rules',
    'firestore-social.rules', 'storage.rules', 'wrangler.toml'
]);
const SECRET_FILE = /^(\.env(\..+)?|service-account.*\.json|.*\.pem|.*\.p12|id_rsa.*)$/i;

const problems = [];
function walk(dir, depth) {
    if (depth > 5) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        const relp = path.relative(abs, fp).replace(/\\/g, '/');
        if (entry.isDirectory()) {
            if (FORBIDDEN_DIRS.has(entry.name)) problems.push(relp + '/');
            else walk(fp, depth + 1);
        } else if (FORBIDDEN_FILES.has(entry.name) || SECRET_FILE.test(entry.name)) {
            problems.push(relp);
        }
    }
}
walk(abs, 0);

if (problems.length) {
    fail('Credential or backend files found in the deploy directory:\n  ' +
         problems.slice(0, 40).join('\n  ') +
         (problems.length > 40 ? `\n  ...and ${problems.length - 40} more` : ''));
}

console.log(`Deploy guard OK: ${rel} contains no credential or backend files.`);
