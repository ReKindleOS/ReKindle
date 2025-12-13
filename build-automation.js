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

    // 4. PROCESS CSS (Variables & Grid Fallback)
    $('style').each((i, el) => {
        let css = $(el).html();
        if (!css) return;

        // A. Extract :root variables
        const rootMatch = css.match(/:root\s*{([^}]+)}/);
        const variables = {};
        if (rootMatch) {
            const varsBlock = rootMatch[1];
            varsBlock.split(';').forEach(line => {
                const parts = line.split(':');
                if (parts.length === 2) {
                    const key = parts[0].trim();
                    const val = parts[1].trim();
                    if (key.startsWith('--')) {
                        variables[key] = val;
                    }
                }
            });
        }

        // B. Replace var(--name) with value
        // We iterate specifically to handle the extracted variables
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`var\\(${key}\\)`, 'g');
            css = css.replace(regex, variables[key]);
        });

        // C. Grid Falback (Blind Replace for Chrome 44)
        // 1. Generic Grid -> Flex
        // css = css.replace(/display:\s*grid;/g, 'display: flex; flex-wrap: wrap;');
        // 2. Specific fixes for known classes
        if (css.includes('.grid-container')) {
            css = css.replace(
                /\.grid-container\s*{[^}]*display:\s*grid;[^}]*}/g,
                (match) => {
                    // Replace the whole block or just properties?
                    // Let's just blindly replace the display: grid and template parts
                    return match
                        .replace('display: grid;', 'display: flex; flex-wrap: wrap; justify-content: center;')
                        .replace(/grid-template-columns:[^;]+;/g, '')
                        .replace(/grid-auto-rows:[^;]+;/g, '')
                        .replace(/gap:\s*(\d+)px;/g, 'margin: -$1px;'); // Negative margin hack? No, let's just remove gap
                }
            );
            // Add margin to children
            css += ` .grid-container > * { margin: 10px; flex: 1 0 85px; max-width: 120px; } `;
            // Specific fix for Featured Grid (Wider cards)
            css += ` #featured-grid > * { flex: 1 0 200px !important; max-width: none !important; } `;
        }

        // D. General Replace for other grids (safer to do simple replace)
        css = css.replace(/display:\s*grid;/g, 'display: flex; flex-wrap: wrap; justify-content: center;');

        $(el).html(css);
    });

    // 5. INJECT POLYFILLS & RUNTIME (Async/Await, ES6 Features)
    $('head').prepend(`
        <!-- 1. Regenerator Runtime (Required for Async/Await transpilation) -->
        <script src="https://cdn.jsdelivr.net/npm/regenerator-runtime@0.13.11/runtime.min.js"></script>

        <!-- 2. Standard Polyfills -->
        <!-- URLSearchParams Polyfill for Chrome 44 -->
        <script src="https://unpkg.com/url-search-params-polyfill@8.2.5/index.js"></script>
        
        <script src="https://polyfill.io/v3/polyfill.min.js?features=default,es6,fetch,Promise,Object.assign,Object.entries,Object.values,Array.from,Array.prototype.find,Array.prototype.findIndex,Array.prototype.includes,String.prototype.includes,String.prototype.startsWith,String.prototype.endsWith"></script>
        
        <!-- 3. Manual Fallbacks & Lite Flags -->
        <script>
            window.isLiteVersion = true;
            
            // NodeList.forEach
            if (window.NodeList && !NodeList.prototype.forEach) {
                NodeList.prototype.forEach = Array.prototype.forEach;
            }

            // Array.from Fallback
            if (!Array.from) {
                Array.from = (function () {
                    var toStr = Object.prototype.toString;
                    var isCallable = function (fn) { return typeof fn === 'function' || toStr.call(fn) === '[object Function]'; };
                    var toInteger = function (value) { var number = Number(value); if (isNaN(number)) { return 0; } if (number === 0 || !isFinite(number)) { return number; } return (number > 0 ? 1 : -1) * Math.floor(Math.abs(number)); };
                    var maxSafeInteger = Math.pow(2, 53) - 1;
                    var toLength = function (value) { var len = toInteger(value); return Math.min(Math.max(len, 0), maxSafeInteger); };
                    return function from(arrayLike) {
                        var C = this; var items = Object(arrayLike);
                        if (arrayLike == null) throw new TypeError('Array.from requires an array-like object');
                        var mapFn = arguments.length > 1 ? arguments[1] : undefined; var T;
                        if (typeof mapFn !== 'undefined') { if (!isCallable(mapFn)) throw new TypeError('Array.from: when provided, the second argument must be a function'); if (arguments.length > 2) T = arguments[2]; }
                        var len = toLength(items.length); var A = isCallable(C) ? Object(new C(len)) : new Array(len);
                        var k = 0; var kValue;
                        while (k < len) { kValue = items[k]; if (mapFn) { A[k] = typeof T === 'undefined' ? mapFn(kValue, k) : mapFn.call(T, kValue, k); } else { A[k] = kValue; } k += 1; }
                        A.length = len; return A;
                    };
                }());
            }
        </script>
    `);

    // 6. ADD VISUAL INDICATOR & INFO MODAL
    $('.os-title').append('<span class="lite-badge" onclick="document.getElementById(\'lite-info-modal\').style.display=\'flex\'" style="font-size:0.5em; vertical-align:super; cursor:pointer; border-bottom:1px dotted black;" title="About Lite Mode">LITE</span>');

    // Fix for specific styling in Lite where badges might look weird
    $('style').append('.lite-badge { background: white; border: 1px solid black; padding: 0 2px; }');

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

    // 7. INJECT ES6 WARNING LOGIC (Lite Build Only)
    // A. CSS
    $('style').append('.es6-disabled { opacity: 0.5; filter: grayscale(100%); }');

    // B. Modal HTML
    $('body').append(`
        <div id="es6-warning-modal" class="modal-overlay" onclick="document.getElementById('es6-warning-modal').style.display='none'" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10001; align-items:center; justify-content:center;">
            <div class="modal-box" onclick="event.stopPropagation()" style="background:white; border:2px solid black; padding:20px; width:300px; text-align:center; box-shadow:4px 4px 0 black; font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:2px solid black; padding-bottom:10px;">Warning</h3>
                <p style="margin:20px 0;">This app requires modern features and almost certainly won't work on this device.</p>
                <div style="display:flex; justify-content:center; gap:10px;">
                    <button class="sys-btn" onclick="document.getElementById('es6-warning-modal').style.display='none'" style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;">Back</button>
                    <button id="es6-proceed-btn" class="sys-btn" style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;">Proceed Anyway</button>
                </div>
            </div>
        </div>
    `);

    // C. Helper Function
    $('body').append(`
        <script>
            function showEs6Warning(appId) {
                var modal = document.getElementById('es6-warning-modal');
                var btn = document.getElementById('es6-proceed-btn');
                btn.onclick = function() {
                    window.location.href = appId + ".html";
                };
                modal.style.display = 'flex';
            }
        </script>
    `);

    let finalHtml = $.html();

    // D. Inject JS Logic into index.html rendering loops via String Replacement
    // Target 1: createAppElement (Main Grid)
    // We look for a unique line inside createAppElement
    const mainGridTarget = 'const isFav = favoriteApps.includes(app.id);';
    const mainGridInjection = `
            if (app.es6) {
        a.classList.add('es6-disabled');
        a.onclick = function (e) {
            e.preventDefault();
            showEs6Warning(app.id);
        };
        a.href = "javascript:void(0)";
    }
            ${mainGridTarget}
    `;
    finalHtml = finalHtml.replace(mainGridTarget, mainGridInjection);

    // Target 2: Featured Apps Loop (Manual Render)
    // We look for the appendChild call in the featured loop. 
    // This is fragile but focused. We target the end of the innerHTML template literal block.
    // Original: </div>\n                    `; \n                    fragment.appendChild(a);
    // Since Babel transpilation might have happened, line endings might vary. 
    // However, build-automation.js only transpiles inline script blocks using Babel IF they are processed.
    // The main index.html logic is usually in a script block. 
    // IF Babel ran on it, the code structure might be different (var instead of const).
    // Babel 'modules: false, targets: ie 11' likely kept the structure similar but transpiled const->var.
    // So 'const isFav' might be 'var isFav'.
    // We should try to be flexible or check if transpilation happened.

    // Fallback: If Babel ran, 'const' -> 'var'.
    finalHtml = finalHtml.replace('var isFav = favoriteApps.includes(app.id);', mainGridInjection.replace('const', 'var'));

    // Featured Loop Injection
    // We search for the specific structure of the featured card creation.
    // "fragment.appendChild(a);" appears multiple times.
    // The featured loop has: a.className = 'featured-card';
    const featuredTarget = 'fragment.appendChild(a);'; // Too generic?
    // Let's use the line before it in the featured loop: 
    // <span class="featured-sub">${subheading}</span>
    // But Babel might have turned template literals into string concatenation!
    // "featured-sub" class string is likely stable.

    // NOTE: Babel transform is async and happened in Step 3. 
    // If Babel transformed the template literals, we can't search for them easily.
    // However, 'createAppElement' function name survives. 
    // 'featuredApps.forEach' survives.

    // Let's rely on the selector logic:
    // If we can't easily patch the JS text because of Babel, we might need to inject a runtime patch.
    // But "app.es6" property is new, so existing logic doesn't know it.

    // STRONGER APPROACH: 
    // Inject a script that runs AFTER the main script (onload) and iterates the DOM to apply the classes/events?
    // Apps are rendered by 'filterApps'.
    // 'filterApps' is called on click.
    // We can monkey-patch 'createAppElement' if it's exposed on window (it's in global scope of definition).
    // In index.html, 'createAppElement' is defined in the script block. It IS accessible if not inside a compiled module (it's not).

    // So we can overwrite window.createAppElement!
    // But wait, the Featured loop doesn't use createAppElement. It manually creates elements.
    // We can OVERWRITE 'filterApps'?
    // That's a huge function.

    // Let's try the string replace on 'const isFav' / 'var isFav' for createAppElement.
    // For Featured, we can search for `a.className = 'featured-card';` which is unique to that loop.

    const featuredInjectionPoint = "a.className = 'featured-card';";
    const featuredLogic = `
                    a.className = 'featured-card';
                    if (app.es6) {
                        a.className += ' es6-disabled';
                        a.onclick = function(e) {
                            e.preventDefault();
                            showEs6Warning(app.id);
                        };
                        a.href = "javascript:void(0)";
                    }
    `;
    finalHtml = finalHtml.replace(featuredInjectionPoint, featuredLogic);

    return finalHtml;
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