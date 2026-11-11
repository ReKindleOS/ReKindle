#!/usr/bin/env node
/**
 * Guards the deploy guards (2026-11-11).
 *
 * `npm run deploy:beta` publishes whatever is in _deploy/main, so two things
 * must stay true:
 *   1. the npm script runs the build + deploy-guard BEFORE wrangler, and never
 *      points wrangler at the repo root (the 2026-10-19 credential leak);
 *   2. the scanner actually catches the shapes that a name-only check missed -
 *      a renamed Firebase admin SDK key, a nested .env, and key material
 *      embedded in an ordinary file.
 *
 * Hermetic: uses os.tmpdir() plus a self-cleaning _deploy/__guard-test-<pid>
 * directory. Run with `node scripts/test-deploy-guard.js` (part of `npm test`).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { scanDeployDir } = require('./lib/deploy-secrets');

const problemsFor = dir => scanDeployDir(dir).map(p => p.path + ' [' + p.reason + ']');
const cleanups = [];
function tmp(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    cleanups.push(dir);
    return dir;
}
function runGuard(target) {
    try {
        const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/deploy-guard.js'), target], {
            cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
        });
        return { code: 0, out };
    } catch (err) {
        return { code: err.status === undefined ? 1 : err.status, out: (err.stdout || '') + (err.stderr || '') };
    }
}

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ok  ' + name);
    } catch (err) {
        console.error('  FAIL ' + name);
        throw err;
    }
}

console.log('deploy guard: npm script ordering');

const pkg = require('../package.json');
for (const script of ['deploy:beta', 'deploy:prod']) {
    test(script + ' runs build, then the guard, then wrangler on _deploy', () => {
        const cmd = pkg.scripts[script];
        assert.ok(cmd, script + ' missing from package.json');
        const buildAt = cmd.indexOf('npm run build');
        const guardAt = cmd.indexOf('scripts/deploy-guard.js');
        const wranglerAt = cmd.indexOf('wrangler pages deploy');
        assert.ok(buildAt !== -1, 'build must run first');
        assert.ok(guardAt !== -1, 'deploy-guard must run');
        assert.ok(wranglerAt !== -1, 'wrangler must run');
        assert.ok(buildAt < guardAt && guardAt < wranglerAt, 'order must be build -> guard -> wrangler');
        // The guard must be joined with && so a failure stops wrangler.
        const between = cmd.slice(0, wranglerAt);
        assert.ok(/deploy-guard\.js[^&]*&&/.test(between), 'guard must be &&-chained before wrangler');
        // Never deploy the repo root; only _deploy/<target>.
        const targetMatch = cmd.match(/wrangler pages deploy\s+(\S+)/);
        assert.ok(targetMatch, 'cannot read wrangler target');
        assert.ok(targetMatch[1].startsWith('_deploy/'), 'wrangler target must be under _deploy/, got ' + targetMatch[1]);
        assert.ok(!/(^|\s)\.(\s|$)/.test(targetMatch[1]), 'must not deploy "."');
    });
}

test('beta deploys the guarded build output with --branch=beta', () => {
    assert.ok(/--branch=beta\b/.test(pkg.scripts['deploy:beta']), 'beta script must pass --branch=beta');
    assert.ok(/--project-name=rekindle\b/.test(pkg.scripts['deploy:beta']));
});

test('no npm script deploys an unguarded target', () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
        if (!/wrangler pages deploy/.test(cmd)) continue;
        assert.ok(/scripts\/deploy-guard\.js/.test(cmd), name + ' deploys without the guard');
    }
});

console.log('deploy guard: scanner');

test('clean deploy tree passes', () => {
    const dir = tmp('rk-clean-');
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>hi</body></html>');
    fs.mkdirSync(path.join(dir, 'js'));
    fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'var API_KEY = "AIzaSyPUBLICWEBKEY0123456789abcdefgh";');
    assert.deepStrictEqual(problemsFor(dir), []);
});

test('renamed Firebase Admin SDK key is caught by name', () => {
    const dir = tmp('rk-adminsdk-');
    fs.writeFileSync(path.join(dir, 'rekindle-dd1fa-firebase-adminsdk-abc123.json'), '{"type":"service_account"}');
    assert.ok(problemsFor(dir).length >= 1);
});

test('nested .env deeper than the old depth limit is caught', () => {
    const dir = tmp('rk-nested-');
    const deep = path.join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, '.env'), 'OPENAI_API_KEY=sk-x');
    assert.ok(problemsFor(dir).length >= 1);
});

test('private key embedded in an innocent .js file is caught by content', () => {
    const dir = tmp('rk-content-');
    fs.writeFileSync(path.join(dir, 'vendor.js'),
        'var k = "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg\\n-----END PRIVATE KEY-----\\n";');
    assert.ok(problemsFor(dir).length >= 1);
});

test('service-account JSON content under a harmless name is caught', () => {
    const dir = tmp('rk-sa-');
    fs.writeFileSync(path.join(dir, 'settings.json'),
        '{"type":"service_account","private_key_id":"0123456789abcdef0123456789abcdef01234567"}');
    assert.ok(problemsFor(dir).length >= 1);
});

test('live secret tokens are caught', () => {
    for (const secret of [
        'sk_live_' + 'A'.repeat(24),
        'sk-proj-' + 'B'.repeat(24),
        'ghp_' + 'C'.repeat(36),
        'whsec_' + 'D'.repeat(24)
    ]) {
        const dir = tmp('rk-token-');
        fs.writeFileSync(path.join(dir, 'config.js'), 'var s = "' + secret + '";');
        assert.strictEqual(problemsFor(dir).length, 1, 'not caught: ' + secret.slice(0, 8) + '…');
    }
});

test('symlink into the repo is flagged', () => {
    const dir = tmp('rk-symlink-');
    try {
        fs.symlinkSync(path.join(ROOT, 'service-account.json'), path.join(dir, 'innocent.json'));
    } catch (_) {
        return; // filesystem without symlink support
    }
    assert.ok(problemsFor(dir).length >= 1);
});

console.log('deploy guard: CLI refusals');

test('refuses the repo root', () => {
    const res = runGuard('.');
    assert.notStrictEqual(res.code, 0, 'repo root must be refused');
    assert.ok(/Refusing to deploy the repo root/.test(res.out));
});

test('refuses a directory outside _deploy/', () => {
    const res = runGuard('js');
    assert.notStrictEqual(res.code, 0);
});

test('accepts a clean _deploy target and blocks a poisoned one', () => {
    const name = '__guard-test-' + process.pid;
    const target = path.join(ROOT, '_deploy', name);
    try {
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'index.html'), '<html></html>');
        const ok = runGuard(path.join('_deploy', name));
        assert.strictEqual(ok.code, 0, 'clean target should pass: ' + ok.out);

        fs.writeFileSync(path.join(target, 'leak.json'),
            '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"}');
        const bad = runGuard(path.join('_deploy', name));
        assert.notStrictEqual(bad.code, 0, 'poisoned target must be blocked');
        assert.ok(/DEPLOY BLOCKED/.test(bad.out));
    } finally {
        fs.rmSync(target, { recursive: true, force: true });
    }
});

for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
console.log('\n✅ deploy guard: ' + passed + ' checks passed');
