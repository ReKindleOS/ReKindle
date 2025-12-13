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

    // 2. REPLACE LIBRARIES WITH ES5 COMPATIBLES
    const LIBRARY_REPLACEMENTS = {
        // Firebase: Force 8.10.1 (Last v8 release, fully ES5)
        'firebase': {
            check: (src) => src.includes('firebase') && src.endsWith('.js'),
            replace: (src) => {
                // Determine module type from filename (app, auth, firestore)
                // Source: .../9.6.1/firebase-app-compat.js -> Target: .../8.10.1/firebase-app.js
                const base = src.split('/').pop().replace('-compat', '');
                return `https://www.gstatic.com/firebasejs/8.10.1/${base}`;
            }
        },
        // Marked: Downgrade to 2.1.3 (Last definitely ES5 safe version)
        'marked': {
            check: (src) => src.includes('marked.min.js'),
            replace: () => "https://cdnjs.cloudflare.com/ajax/libs/marked/2.1.3/marked.min.js"
        },
        // Epub.js: Pin to 0.3.88 (Stable for legacy)
        'epub': {
            check: (src) => src.includes('epub.min.js'),
            replace: () => "https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.88/epub.min.js"
        },
        // OpenSheetMusicDisplay: Downgrade to 0.8.3 (Pre-TypeScript/Modern targets)
        'osmd': {
            check: (src) => src.includes('opensheetmusicdisplay'),
            replace: () => "https://cdnjs.cloudflare.com/ajax/libs/opensheetmusicdisplay/0.8.3/opensheetmusicdisplay.min.js"
        },
        // Tone.js/Midi: Pin to 2.0.28 (2021 release)
        'tonejs-midi': {
            check: (src) => src.includes('@tonejs/midi'),
            replace: () => "https://unpkg.com/@tonejs/midi@2.0.28/dist/Midi.js"
        },
        // JSZip: Update to 3.10.1 (IE11/Chrome 44 supported)
        'jszip': {
            check: (src) => src.includes('jszip') && !src.includes('3.10.1'),
            replace: () => "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
        },
        // QRCode: Use davidshimjs-qrcodejs (Standard ES5 lib)
        'qrcode': {
            check: (src) => src.includes('qrcode'),
            replace: () => "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
        },
        // Chess.js: Keep 0.10.3 (Standard ES5)
        'chess': {
            check: (src) => src.includes('chess.js') && !src.includes('0.10.3'),
            replace: () => "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"
        }
    };

    $('script').each((i, el) => {
        let src = $(el).attr('src');
        if (src) {
            for (const [key, rule] of Object.entries(LIBRARY_REPLACEMENTS)) {
                if (rule.check(src)) {
                    const newSrc = rule.replace(src);
                    console.log(`  [${key}] Replaced: ${src} -> ${newSrc}`);
                    $(el).attr('src', newSrc);
                    break; // Only apply one rule per script
                }
            }
        }
    });

    // 3. TRANSPILE INLINE JS
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

    // 4. INJECT POLYFILLS (For Promise, Fetch, etc.)
    $('head').prepend(`
        <script src="https://polyfill.io/v3/polyfill.min.js?features=default,es6,fetch,Promise,Object.assign"></script>
        <script>window.isLiteVersion = true;</script>
    `);

    // 5. ADD VISUAL INDICATOR & INFO MODAL
    $('.os-title').append('<span class="lite-badge" onclick="document.getElementById(\'lite-info-modal\').style.display=\'flex\'" style="font-size:0.5em; vertical-align:super; cursor:pointer; border-bottom:1px dotted black;" title="About Lite Mode">LITE</span>');

    $('body').append(`
        <div id="lite-info-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;" onclick="this.style.display='none'">
            <div class="modal-box" onclick="event.stopPropagation()" style="background:white; border:2px solid black; padding:20px; width:300px; max-width:80%; text-align:center; box-shadow:4px 4px 0 black; font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:2px solid black; padding-bottom:10px;">Lite Version</h3>
                <p style="margin:15px 0;">This is a lightweight version of ReKindle designed for older devices.</p>
                <p style="margin:15px 0; font-size:0.9em;">ReKindle apps and games are untested on these browsers and most likely won't work, proceed with caution.</p>
                <button style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;" onclick="document.getElementById('lite-info-modal').style.display='none'">OK</button>
            </div>
        </div>
    `);

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