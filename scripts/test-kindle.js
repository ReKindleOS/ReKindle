/*
 * ReKindle for jailbroken Kindles: checks.
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
        // Escape every regex metacharacter, not just dots: version.json is repo
        // data, but a future value such as "1.2.3+build(4)" must not alter the
        // pattern or throw "Invalid regular expression".
        const versionPattern = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(code, new RegExp(`^# Version: ${versionPattern}$`, 'm'), `${file} version must match version.json`);
        execFileSync('bash', ['-n', path.join(kindleDir, file)], { stdio: 'pipe' });
    }

    const launcher = fs.readFileSync(path.join(kindleDir, 'ReKindle.sh'), 'utf8');
    assert.match(launcher, /appmgrd start "app:\/\/com\.lab126\.browser#going\?url=\$URL"/, 'launcher must use appmgrd');
    assert.match(launcher, /configureChrome/, 'launcher must blank the URL bar');
    assert.ok(launcher.includes('topNavBar') && launcher.includes('CHROME_JSON'), 'launcher must configure the browser top bar');
    assert.match(launcher, /run_fullscreen/, 'launcher must include the root fullscreen path');
    assert.match(launcher, /watch_brightness/, 'launcher must include the brightness gesture watcher');
    assert.match(launcher, /flIntensity/, 'launcher must control frontlight brightness');
    assert.ok(!launcher.includes('mount -t squashfs'), 'launcher must not mount Chromium');
    assert.ok(!launcher.includes('su - framework'), 'launcher must not need the framework user');
    assert.match(launcher, /^# Icon: \/mnt\/us\/documents\/ReKindleCover\.png$/m, 'launcher must use the library cover');
    assert.match(launcher, /URL="https:\/\/rekindle\.ink\/"/, 'default URL must be the normal ReKindle site');
    assert.match(launcher, /eips 2 2 "ReKindle v\$VERSION"/, 'boot screen must show the version');
    assert.ok(!launcher.includes('?kiosk=1'), 'launcher must not enable app-level fullscreen');
    assert.ok(!/rm\s+-rf\s+\/(\s|$)/.test(launcher), 'launcher must never rm -rf /');

    section('dry-run plan');
    const plan = execFileSync('bash', [path.join(kindleDir, 'ReKindle.sh')], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { REKINDLE_DRY_RUN: '1', REKINDLE_HYBRID: '0' })
    });
    for (const needle of [
        `PLAN: version=${version}`,
        'PLAN: mode=browser-app (GUI/status bar stays)',
        'PLAN: url=https://rekindle.ink/',
        'PLAN: app=app://com.lab126.browser#going?url=https://rekindle.ink/',
        'PLAN: chrome={"appId":"com.lab126.browser","topNavBar":{"template":"blank","height":0}'
    ]) {
        assert.ok(plan.includes(needle), `dry-run output is missing: ${needle}`);
    }
    assert.ok(!plan.includes('stop-gui'), 'browser-app mode must not stop the Kindle GUI');

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
    // Derive the cache-busting version instead of hard-coding it: bumping
    // theme.js?v= in the HTML must be paired with sw.js precaching the same URL,
    // and a hard-coded number turns every bump into a false failure.
    const themeVersion = (read('index.html').match(/theme\.js\?v=(\d+)/) || [])[1];
    assert.ok(themeVersion, 'index.html must load a versioned theme.js');
    assert.ok(sw.includes(`'./theme.js?v=${themeVersion}'`), `sw.js must precache theme.js?v=${themeVersion}`);

    const guide = read('kindle.html');
    for (const needle of [
        'downloads/ReKindle-Fullscreen.zip',
        'downloads/ReKindle.sh',
        'downloads/ReKindle.txt',
        'download="ReKindle.sh"',
        'kindle.sh',
        'kindle.txt',
        'kpm add-repo',
        'kterm',
        'kpm update',
        'kpm install rekindle',
        'https://repo.rekindle.ink',
        'rekindle.ink/downloads/kpm/repo.json',
        'Invalid file type',
        'rekindleApplyWallpaper',
        'kindlemodding.org/jailbreak-wizard.html',
        'normal framed layout',
        `theme.js?v=${themeVersion}`
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
        'documents/ReKindleCover.png',
        'README.txt',
        'rekindle-fullscreen.conf.example',
        'SHA256SUMS.txt'
    ]) {
        assert.ok(entries.includes(entry), `zip is missing ${entry}`);
    }

    assert.ok(!entries.includes('documents/ReKindleStop.sh'), 'Stop app must not be installed from the zip');

    const extract = path.join(tmp, 'extract');
    execFileSync('unzip', ['-q', info.zipPath, '-d', extract], { stdio: 'pipe' });
    for (const file of ['documents/ReKindle.sh']) {
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
    for (const file of ['ReKindle.sh', 'ReKindle.txt', 'ReKindleCover.png', 'SHA256SUMS.txt']) {
        assert.ok(fs.existsSync(path.join(outDir, file)), `standalone ${file} missing`);
    }

    const downloadSums = fs.readFileSync(path.join(outDir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    for (const line of downloadSums) {
        const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
        assert.ok(match, `bad download checksum line: ${line}`);
        assert.strictEqual(sha256(path.join(outDir, match[2])), match[1], `download checksum mismatch for ${match[2]}`);
    }

    section('kpm package');
    const redirects = read('_redirects');
    assert.ok(
        !/repo\.rekindle\.ink\s+https:/.test(redirects),
        'Pages _redirects cannot do domain-level rules; repo.rekindle.ink is the rekindle-kpm Worker route'
    );
    const kpmWorkerConfig = read('workers/rekindle-kpm/wrangler.toml');
    assert.match(kpmWorkerConfig, /pattern = "repo\.rekindle\.ink\/\*"/, 'the KPM Worker must own the repo host route');
    const kpmWorkerPath = path.join(tmp, 'kpm-worker.mjs');
    fs.writeFileSync(kpmWorkerPath, read('workers/rekindle-kpm/worker.js'));
    const kpmWorker = await import('file://' + kpmWorkerPath);
    assert.strictEqual(kpmWorker.mapRepoPath('/'), '/downloads/kpm/repo.json');
    assert.strictEqual(kpmWorker.mapRepoPath('/repo.json'), '/downloads/kpm/repo.json');
    assert.strictEqual(kpmWorker.mapRepoPath('/rekindle_1.0.0_kindlehf.kpkg'), '/downloads/kpm/rekindle_1.0.0_kindlehf.kpkg');
    assert.strictEqual(kpmWorker.mapRepoPath('/../secret'), null);
    assert.strictEqual(kpmWorker.mapRepoPath('/nested/file.kpkg'), null);
    const kpmDir = path.join(outDir, 'kpm');
    const repo = JSON.parse(fs.readFileSync(path.join(kpmDir, 'repo.json'), 'utf8'));
    assert.strictEqual(repo.manifest_version, 2);
    assert.strictEqual(repo.id, 'rekindle');
    const pkg = repo.packages['rekindle'];
    assert.ok(pkg, 'repo is missing the rekindle package');
    assert.strictEqual(pkg.artifacts.length, 1);
    const artifact = pkg.artifacts[0];
    assert.deepStrictEqual(artifact.version, version.split('.').map(function (n) { return parseInt(n, 10); }));
    assert.strictEqual(artifact.supported_platforms, null);

    const kpkg = path.join(kpmDir, artifact.url.split('/').pop());
    assert.ok(fs.existsSync(kpkg), 'KPM artifact is missing');
    assert.match(artifact.url, /^https:\/\/rekindle\.ink\/downloads\/kpm\/rekindle_[0-9.]+_kindlehf\.kpkg$/, 'KPM artifact URL must be absolute for a bare repo host');
    const kpmEntries = execFileSync('tar', ['-tzf', kpkg], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    for (const entry of ['manifest.json', 'install.sh', 'uninstall.sh', 'launch.sh', 'ReKindle.sh', 'ReKindleCover.png']) {
        assert.ok(kpmEntries.includes(entry), `KPM package is missing ${entry}`);
    }

    const kpmExtract = path.join(tmp, 'kpm-extract');
    fs.mkdirSync(kpmExtract, { recursive: true });
    execFileSync('tar', ['-xzf', kpkg, '-C', kpmExtract], { stdio: 'pipe' });
    const kpmManifest = JSON.parse(fs.readFileSync(path.join(kpmExtract, 'manifest.json'), 'utf8'));
    assert.strictEqual(kpmManifest.id, 'rekindle');
    assert.deepStrictEqual(kpmManifest.version, artifact.version);
    const installHook = fs.readFileSync(path.join(kpmExtract, 'install.sh'), 'utf8');
    assert.match(installHook, /cp -f \.\/ReKindle\.sh "\/mnt\/us\/documents\/ReKindle Launcher\.sh"/);
    assert.match(installHook, /cp -f \.\/ReKindleCover\.png \/mnt\/us\/documents\/ReKindleCover\.png/);
    execFileSync('sh', ['-n', path.join(kpmExtract, 'install.sh')], { stdio: 'pipe' });
    execFileSync('sh', ['-n', path.join(kpmExtract, 'uninstall.sh')], { stdio: 'pipe' });

    console.log('PASS - ReKindle checks');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
}

main().catch(err => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
