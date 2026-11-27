#!/usr/bin/env node
/**
 * Builds the gated beta deployment: `_deploy/main` -> `_deploy/beta`.
 *
 * Why a separate target (2026-11-27): Pages Functions are per-deployment, so a
 * `functions/_middleware.js` in the source tree would also ship to production,
 * where it would run for every request (the ~95k invocation/day trap noted in
 * AGENTS.md for repo.rekindle.ink). Copying the already-built main target and
 * injecting the gate only into `_deploy/beta` keeps production untouched.
 *
 * Usage:
 *   BETA_GATE_PASSPHRASE='<long passphrase>' npm run deploy:beta
 *
 * The passphrase is never written to the repository or printed. Only its
 * SHA-256 hash and a cookie-signing key derived from it are embedded in the
 * deployment's Function, which Cloudflare does not serve as a static file.
 *
 * Fails closed: no passphrase (or one shorter than 8 chars) = no build.
 */
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MAIN = path.join(ROOT, '_deploy', 'main');
const BETA = path.join(ROOT, '_deploy', 'beta');
const TEMPLATE = path.join(__dirname, 'beta-gate', 'middleware.js');
const MIN_LENGTH = 8;

function fail(message) {
    console.error('\nBeta gate build failed:\n' + message + '\n');
    process.exit(1);
}

const passphrase = (process.env.BETA_GATE_PASSPHRASE || '').replace(/^\s+|\s+$/g, '');

if (!passphrase) {
    fail(
        'BETA_GATE_PASSPHRASE is not set.\n' +
        'The beta deployment is private, so the build refuses to produce an ungated artefact.\n\n' +
        "  BETA_GATE_PASSPHRASE='your long passphrase' npm run deploy:beta\n\n" +
        'Use at least ' + MIN_LENGTH + ' characters; a 4-6 word phrase is easier to type on a Kindle and much stronger than 8 digits.'
    );
}
if (passphrase.length < MIN_LENGTH) {
    fail('BETA_GATE_PASSPHRASE must be at least ' + MIN_LENGTH + ' characters (got ' + passphrase.length + ').');
}
if (passphrase.length < 12) {
    console.warn('WARNING: the passphrase is only ' + passphrase.length + ' characters. An 8-digit code has ~100M combinations; a longer phrase is much safer.');
}
if (/^[0-9]+$/.test(passphrase)) {
    console.warn('WARNING: numeric-only passphrases are easy to guess and to brute-force offline if the functions bundle leaks. Consider a longer code after testing.');
}
if (!fs.existsSync(MAIN) || !fs.existsSync(path.join(MAIN, 'index.html'))) {
    fail('_deploy/main is missing or incomplete. Run `npm run build` first.');
}
if (!fs.existsSync(TEMPLATE)) {
    fail('Gate template missing: scripts/beta-gate/middleware.js');
}

const passHash = crypto.createHash('sha256').update('rekindle-beta-pass-v1|' + passphrase).digest('hex');
const cookieSecret = crypto.createHash('sha256').update('rekindle-beta-cookie-v1|' + passphrase).digest('hex');

let middleware = fs.readFileSync(TEMPLATE, 'utf8');
if (middleware.indexOf('__PASS_HASH__') === -1 || middleware.indexOf('__COOKIE_SECRET__') === -1) {
    fail('Gate template placeholders are missing; refusing to build an unconfigured gate.');
}
middleware = middleware
    .replace(/__PASS_HASH__/g, passHash)
    .replace(/__COOKIE_SECRET__/g, cookieSecret);

if (middleware.indexOf(passphrase) !== -1) {
    fail('The passphrase itself ended up in the generated middleware; aborting.');
}

// Rebuild the target from scratch so a stale gated copy can never be published
// after a gate change is reverted.
fs.removeSync(BETA);
fs.copySync(MAIN, BETA, { dereference: false });

const functionsDir = path.join(BETA, 'functions');
fs.ensureDirSync(functionsDir);
fs.writeFileSync(path.join(functionsDir, '_middleware.js'), middleware);

// Every request (HTML, assets, API, the gate POST) must reach the middleware.
// Beta traffic is low, and unauthenticated visitors stop after the gate page,
// so this does not multiply invocations the way a project-wide middleware did.
fs.writeFileSync(
    path.join(BETA, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2) + '\n'
);

console.log('Beta gate configured in _deploy/beta');
console.log('  functions/_middleware.js  passphrase hash + cookie secret injected');
console.log('  _routes.json              every request passes through the gate');
console.log('  production target         _deploy/main is untouched');
console.log('\nNext: node scripts/deploy-guard.js _deploy/beta && npx wrangler pages deploy _deploy/beta --project-name=rekindle --branch=beta');
