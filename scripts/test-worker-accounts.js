/**
 * Pin every Worker to its Cloudflare account.
 *
 * Run: node scripts/test-worker-accounts.js
 *
 * Why: on 2026-11-24 a plain `npx wrangler deploy` in workers/rekindle-moderate
 * silently deployed to the main ReKindle account (the one wrangler was logged
 * into) instead of the separate "ReKindle Social" account that serves the live
 * worker. Pinning `account_id` in each wrangler.toml makes a wrong-account
 * deploy fail with 403 instead of writing to the wrong worker, and this test
 * keeps the pins from drifting as workers are added.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MAIN = '264c1185a9930ff6d69502c0c9c6bfd7';
const SOCIAL = '8d69e380e0c4e0580c47f21d9757c71c';

// Workers that must live in the separate "ReKindle Social" account. Everything
// else runs in the main account (see docs/agent/usage-limits.md).
const SOCIAL_WORKERS = new Set(['rekindle-moderate', 'rekindle-translate']);

const workerDirs = fs.readdirSync(path.join(root, 'workers')).filter(d =>
    fs.existsSync(path.join(root, 'workers', d, 'wrangler.toml'))
);
assert.ok(workerDirs.length >= 10, 'expected the worker directories to be present');

for (const dir of workerDirs) {
    const file = path.join('workers', dir, 'wrangler.toml');
    const toml = fs.readFileSync(path.join(root, file), 'utf8');
    const match = /^account_id\s*=\s*"([^"]+)"/m.exec(toml);
    assert.ok(match, `${file}: missing account_id (a bare wrangler deploy would use whichever account is logged in)`);
    const expected = SOCIAL_WORKERS.has(dir) ? SOCIAL : MAIN;
    assert.strictEqual(match[1], expected,
        `${file}: account_id is ${match[1]}, expected ${expected} (${SOCIAL_WORKERS.has(dir) ? 'ReKindle Social' : 'main'} account)`);
}

// The client must keep pointing at the social host, not at whichever workers.dev
// subdomain the deployer happened to be logged into.
const endpoints = fs.readFileSync(path.join(root, 'js', 'social-endpoints.js'), 'utf8');
assert.ok(/moderation:\s*'https:\/\/rekindle-moderate\.rekindle-social\.workers\.dev'/.test(endpoints),
    'js/social-endpoints.js: moderation must point at the ReKindle Social worker');
assert.ok(/translation:\s*'https:\/\/rekindle-translate\.rekindle-social\.workers\.dev'/.test(endpoints),
    'js/social-endpoints.js: translation must point at the ReKindle Social worker');

console.log(`PASS - ${workerDirs.length} worker account pins (${SOCIAL_WORKERS.size} social, ${workerDirs.length - SOCIAL_WORKERS.size} main)`);
