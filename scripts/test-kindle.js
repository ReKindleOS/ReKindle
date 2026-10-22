/*
 * ReKindle Fullscreen (jailbroken Kindle) checks.
 *
 * Run: node scripts/test-kindle.js
 *
 * CI cannot boot a Kindle, so this guards the pieces that are testable:
 *   - scriptlet metadata/syntax and version consistency
 *   - the dry-run plan (URL, flags, power-watch, GUI hand-off)
 *   - the generated zip layout, executable bits and checksums
 *   - the normal framed-layout contract (no app-level fullscreen)
 *   - cache-buster coverage for the shared theme.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const buildKindlePackage = require('./build-kindle');

const root = path.join(__dirname, '..');
const kindleDir = path.join(root, 'kindle');

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function section(title) {
    console.log(`  ${title}`);
}

async function main() {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rekindle-test-kindle-'));
try {
    section('version and metadata');
    const version = JSON.parse(fs.readFileSync(path.join(kindleDir, 'version.json'), 'utf8')).version;
    assert.match(version, /^\d+\.\d+\.\d+$/, 'kindle/version.json must be semver');

    for (const file of ['ReKindle.sh', 'ReKindleStop.sh']) {
        const code = fs.readFileSync(path.join(kindleDir, file), 'utf8');
        assert.ok(!code.includes('\r'), `${file} must use LF endings`);
        assert.ok(code.startsWith('#!/bin/bash\n'), `${file} must start with #!/bin/bash`);
        assert.match(code, /^# Name: /m, `${file} is missing scriptlet metadata`);
        assert.match(code, /^# Author: /m, `${file} is missing author metadata`);
        assert.match(code, /^# DontUseFBInk$/m, `${file} must use # DontUseFBInk`);
        assert.match(code, new RegExp(`^# Version: ${version.replace(/\./g, '\\.')}$`, 'm'), `${file} version must match version.json`);
        execFileSync('bash', ['-n', path.join(kindleDir, file)], { stdio: 'pipe' });
    }

    const launcher = fs.readFileSync(path.join(kindleDir, 'ReKindle.sh'), 'utf8');
    assert.match(launcher, /BROWSER="\/usr\/bin\/chromium\/bin\/kindle_browser"/, 'Chromium browser path changed');
    assert.match(launcher, /stop lab126_gui/, 'launcher must stop the Kindle GUI');
    assert.match(launcher, /start lab126_gui/, 'launcher must restore the Kindle GUI');
    assert.match(launcher, /preventScreenSaver/, 'launcher must manage the screensaver');
    assert.match(launcher, /--js-flags=jitless/, 'launcher must disable JIT');
    assert.match(launcher, /--content-shell-hide-toolbar/, 'launcher must hide the browser toolbar');
    assert.match(launcher, /^# Icon: \/mnt\/us\/documents\/ReKindleCover\.png$/m, 'launcher must use the library cover');
    assert.match(launcher, /https:\/\/rekindle\.ink\/$/m, 'default URL must be the normal ReKindle site');
    assert.ok(!launcher.includes('?kiosk=1'), 'launcher must not enable app-level fullscreen');
    assert.ok(!/rm\s+-rf\s+\/(\s|$)/.test(launcher), 'launcher must never rm -rf /');

    section('dry-run plan');
    const plan = execFileSync('bash', [path.join(kindleDir, 'ReKindle.sh')], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { REKINDLE_DRY_RUN: '1' })
    });
    for (const needle of [
        `PLAN: version=${version}`,
        'PLAN: url=https://rekindle.ink/',
        'PLAN: browser=/usr/bin/chromium/bin/kindle_browser',
        'prevent-screensaver',
        'stop-gui',
        'launch-browser',
        'watch-power',
        'restore-gui',
        '--force-device-scale-factor=',
        '--js-flags=jitless',
        '--content-shell-hide-toolbar',
        '--content-shell-host-window-cord=0,215'
    ]) {
        assert.ok(plan.includes(needle), `dry-run output is missing: ${needle}`);
    }

    section('normal display contract');
    const theme = read('theme.js');
    assert.ok(!theme.includes('rekindle-kiosk'), 'theme.js must not include kiosk CSS');
    assert.ok(!theme.includes('rekindle_kiosk'), 'theme.js must not include the kiosk flag');
    assert.match(theme, /cleanUrl \+ window\.location\.search/, 'the pretty-URL rewrite must preserve ?lang / ?login');
    assert.ok(!theme.includes('?.') && !theme.includes('??'), 'theme.js must stay ES2019-safe');

    const settings = read('settings.html');
    assert.ok(!settings.includes('toggle-kiosk'), 'Settings must not include the kiosk toggle');
    assert.ok(!settings.includes('rekindle_kiosk'), 'Settings must not persist a kiosk flag');

    for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'ru', 'vi', 'zh']) {
        const strings = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${lang}.json`), 'utf8'));
        assert.ok(!strings['settings.kindle_fullscreen'], `${lang}.json still has settings.kindle_fullscreen`);
        assert.ok(!strings['settings.desc.kindle_fullscreen'], `${lang}.json still has settings.desc.kindle_fullscreen`);
    }

    const sw = read('sw.js');
    assert.match(sw, /'\.\/theme\.js\?v=23'/, 'sw.js must precache theme.js?v=23');

    const guide = read('kindle.html');
    for (const needle of [
        'downloads/ReKindle-Fullscreen.zip',
        'downloads/ReKindle.sh',
        'downloads/ReKindle.txt',
        'downloads/ReKindleStop.sh',
        'download="ReKindle.sh"',
        'kindle.sh',
        'kindle.txt',
        'kpm add-repo',
        'kpm update',
        'kpm install rekindle',
        'https://repo.rekindle.ink',
        'rekindle.ink/downloads/kpm/repo.json',
        'Invalid file type',
        'rekindleApplyWallpaper',
        'kindlemodding.org/jailbreak-wizard.html',
        'Kindle Fullscreen',
        'normal framed layout',
        'theme.js?v=23'
    ]) {
        assert.ok(guide.includes(needle), `kindle.html is missing: ${needle}`);
    }

    const headers = read('_headers');
    assert.match(headers, /\/downloads\/ReKindle-Fullscreen\.zip[\s\S]*Content-Disposition: attachment/, '_headers must force the zip download as an attachment');
    assert.match(headers, /\/downloads\/ReKindle\.txt[\s\S]*filename="ReKindle\.sh"/, '.txt alias must save as ReKindle.sh');
    assert.match(headers, /\/kindle\.sh[\s\S]*filename="ReKindle\.sh"/, '/kindle.sh must save as ReKindle.sh');
    assert.match(headers, /\/kindle\.txt[\s\S]*filename="ReKindle\.sh"/, '/kindle.txt must save as ReKindle.sh');
    assert.match(headers, /\/downloads\/kpm\/\*[\s\S]*Cache-Control: no-cache/, 'KPM repo/package must not be cached');

    const help = read('help-data.js');
    assert.ok(help.includes("id: 'kindle-fullscreen'"), 'help-data.js is missing the Kindle Fullscreen article');

    section('package');
    const outDir = path.join(tmp, 'downloads');
    const info = await buildKindlePackage({ outDir, log: function () { } });
    assert.strictEqual(info.version, version);
    assert.ok(fs.existsSync(info.zipPath), 'zip was not created');

    const entries = execFileSync('unzip', ['-Z1', info.zipPath], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    for (const entry of [
        'documents/',
        'documents/ReKindle.sh',
        'documents/ReKindleStop.sh',
        'documents/ReKindleCover.png',
        'README.txt',
        'rekindle-fullscreen.conf.example',
        'SHA256SUMS.txt'
    ]) {
        assert.ok(entries.includes(entry), `zip is missing ${entry}`);
    }

    const extract = path.join(tmp, 'extract');
    execFileSync('unzip', ['-q', info.zipPath, '-d', extract], { stdio: 'pipe' });
    for (const file of ['documents/ReKindle.sh', 'documents/ReKindleStop.sh']) {
        const mode = fs.statSync(path.join(extract, file)).mode & 0o777;
        assert.strictEqual(mode, 0o755, `${file} must be executable in the zip`);
    }
    assert.strictEqual(fs.statSync(path.join(extract, 'documents/ReKindleCover.png')).mode & 0o777, 0o644, 'cover must not be executable');

    const sums = fs.readFileSync(path.join(extract, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    for (const line of sums) {
        const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
        assert.ok(match, `bad checksum line: ${line}`);
        assert.strictEqual(sha256(path.join(extract, match[2])), match[1], `checksum mismatch for ${match[2]}`);
    }

    section('guide downloads');
    for (const file of ['ReKindle.sh', 'ReKindle.txt', 'ReKindleStop.sh', 'ReKindleStop.txt', 'ReKindleCover.png', 'SHA256SUMS.txt']) {
        assert.ok(fs.existsSync(path.join(outDir, file)), `standalone ${file} missing`);
    }

    const downloadSums = fs.readFileSync(path.join(outDir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    for (const line of downloadSums) {
        const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
        assert.ok(match, `bad download checksum line: ${line}`);
        assert.strictEqual(sha256(path.join(outDir, match[2])), match[1], `download checksum mismatch for ${match[2]}`);
    }

    section('kpm package');
    const middleware = read('functions/_middleware.js');
    assert.match(middleware, /repo\.rekindle\.ink/, 'middleware must handle the repo host');
    assert.match(middleware, /ASSETS\.fetch/, 'middleware must serve repo artifacts');
    const kpmDir = path.join(outDir, 'kpm');
    const repo = JSON.parse(fs.readFileSync(path.join(kpmDir, 'repo.json'), 'utf8'));
    assert.strictEqual(repo.manifest_version, 2);
    assert.strictEqual(repo.id, 'rekindle');
    const pkg = repo.packages['rekindle'];
    assert.ok(pkg, 'repo is missing the rekindle package');
    assert.strictEqual(pkg.artifacts.length, 1);
    const artifact = pkg.artifacts[0];
    assert.deepStrictEqual(artifact.version, version.split('.').map(function (n) { return parseInt(n, 10); }));
    assert.deepStrictEqual(artifact.supported_platforms, ['kindlehf']);

    const kpkg = path.join(kpmDir, artifact.url.split('/').pop());
    assert.ok(fs.existsSync(kpkg), 'KPM artifact is missing');
    assert.match(artifact.url, /^https:\/\/rekindle\.ink\/downloads\/kpm\/rekindle_[0-9.]+_kindlehf\.kpkg$/, 'KPM artifact URL must be absolute for a bare repo host');
    const kpmEntries = execFileSync('tar', ['-tzf', kpkg], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    for (const entry of ['manifest.json', 'install.sh', 'uninstall.sh', 'ReKindle.sh', 'ReKindleStop.sh', 'ReKindleCover.png']) {
        assert.ok(kpmEntries.includes(entry), `KPM package is missing ${entry}`);
    }

    const kpmExtract = path.join(tmp, 'kpm-extract');
    fs.mkdirSync(kpmExtract, { recursive: true });
    execFileSync('tar', ['-xzf', kpkg, '-C', kpmExtract], { stdio: 'pipe' });
    const kpmManifest = JSON.parse(fs.readFileSync(path.join(kpmExtract, 'manifest.json'), 'utf8'));
    assert.strictEqual(kpmManifest.id, 'rekindle');
    assert.deepStrictEqual(kpmManifest.version, artifact.version);
    const installHook = fs.readFileSync(path.join(kpmExtract, 'install.sh'), 'utf8');
    assert.match(installHook, /cp -f \.\/ReKindle\.sh \/mnt\/us\/documents\/ReKindle\.sh/);
    assert.match(installHook, /cp -f \.\/ReKindleCover\.png \/mnt\/us\/documents\/ReKindleCover\.png/);
    execFileSync('sh', ['-n', path.join(kpmExtract, 'install.sh')], { stdio: 'pipe' });
    execFileSync('sh', ['-n', path.join(kpmExtract, 'uninstall.sh')], { stdio: 'pipe' });


    section('repo host middleware');
    const mwPath = path.join(tmp, 'middleware.mjs');
    fs.writeFileSync(mwPath, fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8'));
    const mw = await import('file://' + mwPath);
    function repoContext(host, pathname) {
        return {
            request: new Request('https://' + host + pathname),
            env: {
                ASSETS: {
                    fetch: async function (input) {
                        const p = new URL(input).pathname;
                        if (p === '/downloads/kpm/repo.json') {
                            return new Response('{"manifest_version":2,"id":"rekindle","packages":{}}', {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                        if (p.endsWith('.kpkg')) {
                            return new Response('PKG', { headers: { 'Content-Type': 'application/octet-stream' } });
                        }
                        return new Response('missing', { status: 404 });
                    }
                }
            },
            next: async function () { return new Response('APP'); }
        };
    }
    let res = await mw.onRequest(repoContext('repo.rekindle.ink', '/'));
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /application\/json/);
    assert.match(await res.text(), /"id":"rekindle"/);
    res = await mw.onRequest(repoContext('repo.rekindle.ink', '/rekindle_1.0.0_kindlehf.kpkg'));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/octet-stream');
    res = await mw.onRequest(repoContext('repo.rekindle.ink', '/../secret'));
    assert.strictEqual(res.status, 404);
    res = await mw.onRequest(repoContext('rekindle.ink', '/'));
    assert.strictEqual(await res.text(), 'APP');

    console.log('PASS - Kindle Fullscreen checks');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
}

main().catch(err => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
