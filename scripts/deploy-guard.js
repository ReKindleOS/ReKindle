#!/usr/bin/env node
/**
 * Deploy guard — refuses to publish a directory that contains repo credentials.
 *
 * Why this exists (2026-10-19/20 incident): `npx wrangler pages deploy .`
 * uploaded firebase-functions/.env, service-account.json and
 * service-account-social.json from the repo root. build-automation.js only
 * protects `npm run build`; this protects the wrangler step, including a
 * hand-typed deploy of the wrong folder.
 *
 * Usage:
 *   node scripts/deploy-guard.js _deploy/main
 *   npm run deploy:prod   (runs this before wrangler)
 *   npm run deploy:beta   (same guard, then --branch=beta)
 *
 * Only directories under _deploy/ may be published. The scan itself lives in
 * scripts/lib/deploy-secrets.js and is shared with build-automation.js so the
 * build and the publish step cannot disagree about what a secret is.
 *
 * Scanned on every run (2026-11-11 hardening):
 *   - every nested file/dir, no depth limit (the old 5-level cap missed a
 *     nested .env, proved by planting one)
 *   - filenames: service-account*, *adminsdk*, .env*, *.pem/.key/.p8/.p12,
 *     credentials*.json, .npmrc, SSH keys, ...
 *   - CONTENTS of text files: PEM blocks, Google service-account JSON,
 *     OpenAI/Stripe/GitHub/Slack/AWS key formats
 *   - symlinks (wrangler can follow one out of the deploy tree)
 */
const fs = require('fs');
const path = require('path');
const { scanDeployDir, formatProblems } = require('./lib/deploy-secrets');

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

const problems = scanDeployDir(abs);

if (problems.length) {
    fail('Credential or backend files found in the deploy directory:\n  ' + formatProblems(problems));
}

console.log(`Deploy guard OK: ${rel} contains no credential or backend files.`);
