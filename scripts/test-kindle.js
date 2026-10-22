/*
 * ReKindle Fullscreen (jailbroken Kindle) checks.
 *
 * Run: node scripts/test-kindle.js
 *
 * CI cannot boot a Kindle, so this guards the pieces that are testable:
 *   - scriptlet metadata/syntax and version consistency
 *   - the dry-run plan (URL, flags, power-watch, GUI hand-off)
 *   - the generated zip layout, executable bits and checksums
 *   - the kiosk contract between theme.js, Settings and the guide page
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
    assert.match(launcher, /https:\/\/rekindle\.ink\/\?kiosk=1/, 'default URL must enable kiosk mode');
    assert.ok(!/rm\s+-rf\s+\/(\s|$)/.test(launcher), 'launcher must never rm -rf /');

    section('dry-run plan');
    const plan = execFileSync('bash', [path.join(kindleDir, 'ReKindle.sh')], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { REKINDLE_DRY_RUN: '1' })
    });
    for (const needle of [
        `PLAN: version=${version}`,
        'PLAN: url=https://rekindle.ink/?kiosk=1',
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

    section('web kiosk contract');
    const theme = read('theme.js');
    assert.match(theme, /KIOSK_KEY = 'rekindle_kiosk'/, 'theme.js must use the rekindle_kiosk key');
    assert.match(theme, /getUrlParam\('kiosk'\)/, 'theme.js must parse ?kiosk');
    assert.match(theme, /window\.rekindleSetKiosk = function/, 'theme.js must expose rekindleSetKiosk');
    assert.match(theme, /html\.rekindle-kiosk \.window/, 'theme.js must inject kiosk window CSS');
    assert.match(theme, /cleanUrl \+ window\.location\.search/, 'the pretty-URL rewrite must preserve ?kiosk / ?lang');
    assert.match(theme, /html\.rekindle-kiosk \.modal-overlay/, 'kiosk must raise body-level modal overlays');
    assert.ok(!theme.includes("' z-index: 900 !important;'"), 'kiosk must not raise .window above body modals');
    assert.ok(!theme.includes('?.') && !theme.includes('??'), 'theme.js must stay ES2019-safe');

    const settings = read('settings.html');
    assert.match(settings, /id="toggle-kiosk"/, 'Settings is missing the kiosk toggle');
    assert.match(settings, /toggleService\('kiosk'\)/, 'Settings must handle the kiosk toggle');
    assert.match(settings, /rekindle_kiosk/, 'Settings must persist rekindle_kiosk');

    for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'ru', 'vi', 'zh']) {
        const strings = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${lang}.json`), 'utf8'));
        assert.ok(strings['settings.kindle_fullscreen'], `${lang}.json is missing settings.kindle_fullscreen`);
        assert.ok(strings['settings.desc.kindle_fullscreen'], `${lang}.json is missing settings.desc.kindle_fullscreen`);
    }

    const sw = read('sw.js');
    assert.match(sw, /'\.\/theme\.js\?v=22'/, 'sw.js must precache theme.js?v=22');

    const guide = read('kindle.html');
    for (const needle of [
        'downloads/ReKindle-Fullscreen.zip',
        'downloads/ReKindle.sh',
        'downloads/ReKindle.txt',
        'downloads/ReKindleStop.sh',
        'downloads/ReKindleStop.txt',
        'download="ReKindle.sh"',
        'kindle.sh',
        'kindle.txt',
        'kindlemodding.org/jailbreak-wizard.html',
        'Kindle Fullscreen',
        '?kiosk=0',
        'theme.js?v=22'
    ]) {
        assert.ok(guide.includes(needle), `kindle.html is missing: ${needle}`);
    }

    const headers = read('_headers');
    assert.match(headers, /\/downloads\/ReKindle-Fullscreen\.zip[\s\S]*Content-Disposition: attachment/, '_headers must force the zip download as an attachment');
    assert.match(headers, /\/downloads\/ReKindle\.txt[\s\S]*filename="ReKindle\.sh"/, '.txt alias must save as ReKindle.sh');
    assert.match(headers, /\/kindle\.sh[\s\S]*filename="ReKindle\.sh"/, '/kindle.sh must save as ReKindle.sh');
    assert.match(headers, /\/kindle\.txt[\s\S]*filename="ReKindle\.sh"/, '/kindle.txt must save as ReKindle.sh');

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

    const sums = fs.readFileSync(path.join(extract, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    for (const line of sums) {
        const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
        assert.ok(match, `bad checksum line: ${line}`);
        assert.strictEqual(sha256(path.join(extract, match[2])), match[1], `checksum mismatch for ${match[2]}`);
    }

    section('guide downloads');
    for (const file of ['ReKindle.sh', 'ReKindle.txt', 'ReKindleStop.sh', 'ReKindleStop.txt', 'SHA256SUMS.txt']) {
        assert.ok(fs.existsSync(path.join(outDir, file)), `standalone ${file} missing`);
    }

    const downloadSums = fs.readFileSync(path.join(outDir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    for (const line of downloadSums) {
        const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
        assert.ok(match, `bad download checksum line: ${line}`);
        assert.strictEqual(sha256(path.join(outDir, match[2])), match[1], `download checksum mismatch for ${match[2]}`);
    }

    console.log('PASS - Kindle Fullscreen checks');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
}

main().catch(err => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
