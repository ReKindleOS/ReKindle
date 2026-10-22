/*
 * Build the ReKindle Fullscreen add-on for jailbroken Kindles.
 *
 * Run: node scripts/build-kindle.js [outDir]
 *
 * Produces:
 *   downloads/ReKindle-Fullscreen.zip  - extract to the Kindle root
 *   downloads/ReKindle.sh              - single-file launcher download
 *   downloads/ReKindleStop.sh          - recovery scriptlet
 *   downloads/SHA256SUMS.txt           - checksums
 *
 * The zip is assembled from kindle/ at build time so the source tree remains
 * the single source of truth. build-automation.js calls this for every deploy
 * target, which means the download link on /kindle is always current.
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'kindle');
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');

function readVersion() {
    const data = JSON.parse(fs.readFileSync(path.join(SOURCE, 'version.json'), 'utf8'));
    if (!data.version || !/^\d+\.\d+\.\d+$/.test(data.version)) {
        throw new Error(`kindle/version.json has an invalid version: ${JSON.stringify(data.version)}`);
    }
    return data.version;
}

function scriptVersion() {
    const code = fs.readFileSync(path.join(SOURCE, 'ReKindle.sh'), 'utf8');
    const match = /^VERSION="([^"]+)"$/m.exec(code);
    if (!match) throw new Error('kindle/ReKindle.sh is missing VERSION="..."');
    return match[1];
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function setFixedTime(file) {
    fs.utimesSync(file, FIXED_TIME, FIXED_TIME);
}

async function stagePackage(stage) {
    const documents = path.join(stage, 'documents');
    await fs.ensureDir(documents);

    await fs.copy(path.join(SOURCE, 'ReKindle.sh'), path.join(documents, 'ReKindle.sh'));
    await fs.copy(path.join(SOURCE, 'ReKindleStop.sh'), path.join(documents, 'ReKindleStop.sh'));
    await fs.copy(path.join(SOURCE, 'ReKindleCover.png'), path.join(documents, 'ReKindleCover.png'));
    await fs.copy(path.join(SOURCE, 'README.txt'), path.join(stage, 'README.txt'));
    await fs.copy(path.join(SOURCE, 'rekindle-fullscreen.conf.example'), path.join(stage, 'rekindle-fullscreen.conf.example'));

    // Scriptlets are launched by the hotfix, but keeping the executable bit
    // makes the files usable over SSH and from KUAL wrappers too.
    fs.chmodSync(path.join(documents, 'ReKindle.sh'), 0o755);
    fs.chmodSync(path.join(documents, 'ReKindleStop.sh'), 0o755);
    fs.chmodSync(path.join(documents, 'ReKindleCover.png'), 0o644);
    fs.chmodSync(path.join(stage, 'README.txt'), 0o644);
    fs.chmodSync(path.join(stage, 'rekindle-fullscreen.conf.example'), 0o644);

    for (const file of [
        path.join(documents, 'ReKindle.sh'),
        path.join(documents, 'ReKindleStop.sh'),
        path.join(documents, 'ReKindleCover.png'),
        path.join(stage, 'README.txt'),
        path.join(stage, 'rekindle-fullscreen.conf.example')
    ]) {
        setFixedTime(file);
    }

    // Checksums travel with the package so a user can verify the download
    // without trusting the web page.
    const sums = [
        `${sha256(path.join(documents, 'ReKindle.sh'))}  documents/ReKindle.sh`,
        `${sha256(path.join(documents, 'ReKindleStop.sh'))}  documents/ReKindleStop.sh`,
        `${sha256(path.join(documents, 'ReKindleCover.png'))}  documents/ReKindleCover.png`,
        `${sha256(path.join(stage, 'README.txt'))}  README.txt`,
        `${sha256(path.join(stage, 'rekindle-fullscreen.conf.example'))}  rekindle-fullscreen.conf.example`
    ].join('\n') + '\n';
    await fs.writeFile(path.join(stage, 'SHA256SUMS.txt'), sums);
    fs.chmodSync(path.join(stage, 'SHA256SUMS.txt'), 0o644);
    setFixedTime(path.join(stage, 'SHA256SUMS.txt'));
    fs.utimesSync(documents, FIXED_TIME, FIXED_TIME);
}

async function buildKindlePackage(options) {
    const opts = options || {};
    const outDir = path.resolve(opts.outDir || path.join(ROOT, 'downloads'));
    const log = opts.log || console.log;

    const version = readVersion();
    const embedded = scriptVersion();
    if (embedded !== version) {
        throw new Error(`Version mismatch: kindle/version.json is ${version}, kindle/ReKindle.sh is ${embedded}`);
    }

    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'rekindle-kindle-'));
    try {
        await stagePackage(stage);

        await fs.ensureDir(outDir);
        const zipPath = path.join(outDir, 'ReKindle-Fullscreen.zip');
        await fs.remove(zipPath);
        // -X strips extra uid/gid attributes; the fixed mtimes above make the
        // archive reproducible for the same inputs.
        execFileSync('zip', ['-X', '-q', '-r', zipPath, '.'], { cwd: stage, stdio: 'pipe' });

        await fs.copy(path.join(stage, 'documents', 'ReKindle.sh'), path.join(outDir, 'ReKindle.sh'));
        await fs.copy(path.join(stage, 'documents', 'ReKindleStop.sh'), path.join(outDir, 'ReKindleStop.sh'));
        await fs.copy(path.join(stage, 'documents', 'ReKindleCover.png'), path.join(outDir, 'ReKindleCover.png'));

        // Amazon's stock browser only downloads a short allowlist of file types
        // (azw/mobi/txt/...). The .txt copies are the same bytes served under a
        // browser-friendly URL; _headers suggests "ReKindle.sh" as the saved
        // filename so the scriptlet still lands in documents with the right
        // extension. The ZIP remains the universally reliable path.
        await fs.copy(path.join(outDir, 'ReKindle.sh'), path.join(outDir, 'ReKindle.txt'));
        await fs.copy(path.join(outDir, 'ReKindleStop.sh'), path.join(outDir, 'ReKindleStop.txt'));
        fs.chmodSync(path.join(outDir, 'ReKindle.txt'), 0o644);
        fs.chmodSync(path.join(outDir, 'ReKindleStop.txt'), 0o644);

        // KPM package + repository. This is the reliable on-device install:
        // KPM downloads packages with the shell, so Amazon's browser file-type
        // filter never sees them.
        const kpmOut = path.join(outDir, 'kpm');
        await fs.ensureDir(kpmOut);
        const kpkgName = `rekindle_${version}_kindlehf.kpkg`;
        const kpkgPath = path.join(kpmOut, kpkgName);
        const kpmStage = await fs.mkdtemp(path.join(os.tmpdir(), 'rekindle-kpm-'));
        try {
            await fs.copy(path.join(SOURCE, 'kpm', 'manifest.json'), path.join(kpmStage, 'manifest.json'));
            await fs.copy(path.join(SOURCE, 'kpm', 'install.sh'), path.join(kpmStage, 'install.sh'));
            await fs.copy(path.join(SOURCE, 'kpm', 'uninstall.sh'), path.join(kpmStage, 'uninstall.sh'));
            await fs.copy(path.join(outDir, 'ReKindle.sh'), path.join(kpmStage, 'ReKindle.sh'));
            await fs.copy(path.join(outDir, 'ReKindleStop.sh'), path.join(kpmStage, 'ReKindleStop.sh'));
            await fs.copy(path.join(outDir, 'ReKindleCover.png'), path.join(kpmStage, 'ReKindleCover.png'));
            for (const file of ['install.sh', 'uninstall.sh', 'ReKindle.sh', 'ReKindleStop.sh']) {
                fs.chmodSync(path.join(kpmStage, file), 0o755);
            }
            fs.chmodSync(path.join(kpmStage, 'manifest.json'), 0o644);

            await fs.remove(kpkgPath);
            execFileSync('tar', [
                '-czf', kpkgPath,
                '-C', kpmStage,
                'manifest.json', 'install.sh', 'uninstall.sh', 'ReKindle.sh', 'ReKindleStop.sh', 'ReKindleCover.png'
            ], { stdio: 'pipe' });
        } finally {
            await fs.remove(kpmStage);
        }

        const versionParts = version.split('.').map(function (n) { return parseInt(n, 10); });
        const repo = {
            manifest_version: 2,
            id: 'rekindle',
            name: 'ReKindle',
            description: 'ReKindle Fullscreen for jailbroken Kindles',
            packages: {
                'rekindle': {
                    name: 'ReKindle Fullscreen',
                    author: 'ReKindle',
                    description: 'Run ReKindle without the Kindle interface or browser chrome.',
                    artifacts: [
                        {
                            url: 'https://rekindle.ink/downloads/kpm/' + kpkgName,
                            version: versionParts,
                            dependencies: [],
                            supported_platforms: ['kindlehf']
                        }
                    ]
                }
            }
        };
        const repoPath = path.join(kpmOut, 'repo.json');
        await fs.writeFile(repoPath, JSON.stringify(repo, null, 2) + '\n');

        // Checksums for the loose downloads (the zip carries its own list with
        // documents/... paths).
        const downloadSums = [
            `${sha256(path.join(outDir, 'ReKindle.sh'))}  ReKindle.sh`,
            `${sha256(path.join(outDir, 'ReKindle.txt'))}  ReKindle.txt`,
            `${sha256(path.join(outDir, 'ReKindleStop.sh'))}  ReKindleStop.sh`,
            `${sha256(path.join(outDir, 'ReKindleStop.txt'))}  ReKindleStop.txt`,
            `${sha256(path.join(outDir, 'ReKindleCover.png'))}  ReKindleCover.png`,
            `${sha256(zipPath)}  ReKindle-Fullscreen.zip`,
            `${sha256(kpkgPath)}  kpm/${kpkgName}`,
            `${sha256(repoPath)}  kpm/repo.json`
        ].join('\n') + '\n';
        await fs.writeFile(path.join(outDir, 'SHA256SUMS.txt'), downloadSums);

        log(`📦 Kindle package v${version}: ${zipPath} + kpm/${kpkgName}`);
        return { version, zipPath, kpkgPath, repoPath, outDir };
    } finally {
        await fs.remove(stage);
    }
}

module.exports = buildKindlePackage;

if (require.main === module) {
    const outDir = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
    buildKindlePackage({ outDir }).catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    });
}
