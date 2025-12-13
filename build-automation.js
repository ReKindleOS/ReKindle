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

// FILES TO IGNORE (System files & Build artifacts)
const ignoreList = [
    'node_modules', '.git', '.github', '_deploy',
    'build-automation.js', 'package.json', 'package-lock.json',
    'wrangler.toml', '.gitignore', '.DS_Store',
    // Firebase files (Keep in root for DB rules, but don't publish to site)
    'firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json'
];

const filterFunc = (src, dest) => {
    if (ignoreList.includes(path.basename(src))) return false;
    return true;
};

async function transpileHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);

    // 1. REMOVE TRAFFIC COP (Prevents Lite site from redirecting to itself)
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

    // 4. VISUAL INDICATOR
    $('.os-title').append('<span class="lite-badge" style="font-size:0.5em; vertical-align:super;">LITE</span>');
    return $.html();
}

async function run() {
    console.log("🚀 Starting Build...");
    await fs.emptyDir(BUILD_DIR);

    // COPY MAIN SITE
    await fs.copy(SOURCE_DIR, MAIN_DIR, { filter: filterFunc });

    // GENERATE LITE SITE
    await fs.copy(SOURCE_DIR, LITE_DIR, { filter: filterFunc });
    const files = glob.sync(`${LITE_DIR}/**/*.html`);

    for (const file of files) {
        const html = await fs.readFile(file, 'utf8');
        const processed = await transpileHtml(html);
        await fs.outputFile(file, processed);
    }
    console.log("✅ Build Complete!");
}

run().catch(console.error);