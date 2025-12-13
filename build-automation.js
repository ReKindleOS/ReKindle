const fs = require('fs-extra');
const path = require('path');
const babel = require('@babel/core');
const cheerio = require('cheerio');
const glob = require('glob');

// --- CONFIGURATION ---
const SOURCE_DIR = '.';
const BUILD_DIR = './_deploy';
const LITE_DIR = './_deploy/lite';
const MAIN_DIR = './_deploy/main';

// IGNORE LIST
// Prevents system files and backend configs from being published
const ignoreList = [
    'node_modules', '.git', '.github', '_deploy',
    'build-automation.js', 'package.json', 'package-lock.json',
    'wrangler.toml', '.gitignore', '.DS_Store',
    // Firebase Backend Files (Keep in repo, ignore for hosting)
    'firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json'
];

async function transpileHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);

    // 1. REMOVE TRAFFIC COP
    // Prevents the Lite site from checking for legacy browsers and redirecting to itself
    $('script').each((i, el) => {
        const content = $(el).html() || "";
        if (content.includes('Traffic Cop') || content.includes('lite.rekindle.ink')) {
            $(el).remove();
        }
    });

    // 2. TRANSPILE INLINE JS
    const scripts = $('script');
    for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        const $script = $(script);
        const code = $script.html();

        // Only process inline JS (ignore src="..." and non-JS types)
        if (code && !$script.attr('src') && (!$script.attr('type') || $script.attr('type') === 'text/javascript')) {
            try {
                const result = await babel.transformAsync(code, {
                    presets: [['@babel/preset-env', { targets: "ie 11, chrome 43", modules: false }]],
                    comments: false
                });
                $script.html(result.code);
            } catch (err) { }
        }
    }

    // 3. INJECT POLYFILLS (For Promise, Fetch, etc.)
    $('head').prepend(`
        <script src="https://polyfill.io/v3/polyfill.min.js?features=default,es6,fetch,Promise,Object.assign"></script>
        <script>window.isLiteVersion = true;</script>
    `);

    // 4. ADD VISUAL INDICATOR
    $('.os-title').append('<span class="lite-badge" style="font-size:0.5em; vertical-align:super;">LITE</span>');
    return $.html();
}

async function run() {
    console.log("🚀 Starting Build...");

    // 1. Clean & Setup Directories
    await fs.emptyDir(BUILD_DIR);
    await fs.ensureDir(MAIN_DIR);
    await fs.ensureDir(LITE_DIR);

    // 2. Manual Copy Loop (Safer than copying '.')
    const allFiles = await fs.readdir(SOURCE_DIR);

    for (const item of allFiles) {
        if (ignoreList.includes(item)) continue;

        const srcPath = path.join(SOURCE_DIR, item);
        const destMain = path.join(MAIN_DIR, item);
        const destLite = path.join(LITE_DIR, item);

        // Copy to Main
        await fs.copy(srcPath, destMain);

        // Copy to Lite
        await fs.copy(srcPath, destLite);
    }

    // 3. Process Lite HTML Files
    console.log("🛠️  Transpiling Lite Version...");
    const files = glob.sync(`${LITE_DIR}/**/*.html`);

    for (const file of files) {
        const html = await fs.readFile(file, 'utf8');
        const processed = await transpileHtml(html);
        await fs.outputFile(file, processed);
    }

    console.log("✅ Build Complete!");
}

run().catch(console.error);