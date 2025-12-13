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
            replace: () => "https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.min.js"
        },
        // OpenSheetMusicDisplay: Downgrade to 0.8.3 (Pre-TypeScript/Modern targets)
        'osmd': {
            check: (src) => src.includes('opensheetmusicdisplay'),
            replace: () => "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@0.8.3/build/opensheetmusicdisplay.min.js"
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
            // FIX: "All Games" Header Layout
            css += ` .grid-container > .view-header { flex: 1 1 100%; max-width: 100%; margin-top: 25px; margin-bottom: 15px; border-bottom: 2px solid black; } `;
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
                <p style="margin:15px 0; font-size:0.9em;">ReKindle apps and games are not regularly tested on these browsers and often won't work, proceed with caution.</p>
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
                <p style="margin:20px 0;">This app requires modern features and most likely won't work on this device.</p>
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

    // 8. APP-SPECIFIC FIXES
    // A. Mindmap: Fix empty document path error (generate ID if missing)
    if (finalHtml.includes('id="mindmap-canvas"')) {
        console.log("  [Mindmap] Injecting ID generation fix...");
        // Inject check inside saveData
        finalHtml = finalHtml.replace(
            'function saveData() {',
            'function saveData() { if((typeof mindmapId === "undefined" || !mindmapId)) mindmapId = Date.now().toString();'
        );
    }

    // B. Browser: Fix 'history' variable collision (rename to visitHistory)
    if (finalHtml.includes('id="browser-view"')) {
        console.log("  [Browser] Renaming 'history' variable...");

        // 1. Rename declaration and add safety check
        // Pattern: let history = JSON.parse(...) || [];
        // We replace it with var visitHistory...
        finalHtml = finalHtml.replace(
            /let history\s*=\s*JSON\.parse\(localStorage\.getItem\('netlite_history'\)\)\s*\|\|\s*\[\];/,
            `var visitHistory = []; try { var s = JSON.parse(localStorage.getItem('netlite_history')); if(Array.isArray(s)) visitHistory = s; } catch(e) {}`
        );

        // 2. Rename usages
        // Replaces usage in functions (addToHistory, renderHistory, clearHistory)
        // Be careful not to break CSS classes 'history-item', 'history-section'
        // Strategy: Replace 'history' identifier where it is a variable.

        // history. -> visitHistory.
        finalHtml = finalHtml.replace(/history\./g, 'visitHistory.');

        // history = -> visitHistory =
        finalHtml = finalHtml.replace(/history\s*=/g, 'visitHistory =');

        // (history) -> (visitHistory) (e.g. stringify)
        finalHtml = finalHtml.replace(/\(history\)/g, '(visitHistory)');

        // Fix CSS class breakage caused by "history." replacement if any?
        // "history-item" -> "visitHistory-item" ? No, '.' is not in class name in CSS usually.
        // But wait: "div.className = 'history-item';" -> "div.className = 'visitHistory-item';" IF regex matched?
        // No, string is 'history-item'. Regex /history\./ matches "history" followed by dot.
        // String 'history-item' does not contain dot. Safe.
        // CSS references: .history-item { ... } -> Safe.

        // Special case: "history.pushState" (if it existed) -> "visitHistory.pushState".
        // Browser.html doesn't use history API. Safe.
    }

    // C. Pixel App: Fix Grid Layout (Convert to Flex)
    if (finalHtml.includes('id="pixel-canvas"')) {
        console.log("  [Pixel] Injecting Grid -> Flexbox fixes...");
        const pixelParams = `
            .gallery-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .gallery-item { width: 130px !important; height: 156px !important; margin: 10px !important; aspect-ratio: auto !important; }
        `;
        finalHtml = finalHtml.replace('</style>', pixelParams + '</style>');
    }

    // D. Calculator: Fix Button Layout
    if (finalHtml.includes('<title>Calculator</title>')) {
        console.log("  [Calculator] Injecting Flexbox Layout fixes...");
        const calcCss = `
            .keypad { display: flex !important; flex-wrap: wrap !important; justify-content: space-between !important; }
            .keypad button { width: 23% !important; margin-bottom: 12px !important; height: 75px !important; }
            .btn-zero { width: 48% !important; }
        `;
        finalHtml = finalHtml.replace('</style>', calcCss + '</style>');
    }

    // E. Converter: Fix Button Layout
    if (finalHtml.includes('<title>Converter</title>')) {
        console.log("  [Converter] Injecting Flexbox Layout fixes...");
        const convCss = `
            .keypad { display: flex !important; flex-wrap: wrap !important; justify-content: space-between !important; margin-top: 20px !important; }
            .key { width: 23% !important; margin-bottom: 10px !important; height: 50px !important; }
            /* Target the zero key specifically since it spans 2 cols */
            div[style*="span 2"] { width: 48% !important; }
        `;
        finalHtml = finalHtml.replace('</style>', convCss + '</style>');
    }

    // F. 2048: Fix Grid Layout
    if (finalHtml.includes('<title>2048</title>')) {
        console.log("  [2048] Injecting 4x4 Grid Fixes...");
        const g2048Css = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; width: 300px !important; height: 300px !important; align-content: flex-start !important; }
            .cell { width: 68px !important; height: 68px !important; margin: 2px !important; flex: none !important; }
            /* Override generic grid container children styles if they bleed in */
            .grid-container > * { margin: 2px !important; } 
        `;
        finalHtml = finalHtml.replace('</style>', g2048Css + '</style>');
    }

    // G. Connections (Bindings): Fix Grid Layout
    if (finalHtml.includes('<title>Connections</title>')) {
        console.log("  [Connections] Injecting Grid Fixes...");
        const connCss = `
            .grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .card { width: 23% !important; margin: 1% !important; height: 70px !important; }
        `;
        finalHtml = finalHtml.replace('</style>', connCss + '</style>');
    }

    // H. Chess & Checkers (1P & 2P): Fix 8x8 Board
    if (finalHtml.includes('<title>Chess</title>') || finalHtml.includes('<title>Checkers</title>') || finalHtml.includes('id="board"')) {
        // This covers Chess, Checkers, and their 2P variants if they use similar IDs/Titles or if we match by ID
        if (finalHtml.includes('id="board"')) {
            console.log("  [Board Game] Injecting 8x8 Board Fixes...");
            const boardCss = `
                /* We need to override the generic grid replacement that might have happened to #board */
                #board { display: flex !important; flex-wrap: wrap !important; width: 300px !important; height: 300px !important; align-content: flex-start !important; border: 4px solid black !important; }
                .square { width: 12.5% !important; height: 12.5% !important; flex: none !important; margin: 0 !important; padding: 0 !important; }
            `;
            finalHtml = finalHtml.replace('</style>', boardCss + '</style>');
        }
    }

    // I. Battleships: Fix 10x10 Grid
    if (finalHtml.includes('<title>Battleship</title>')) {
        console.log("  [Battleship] Injecting 10x10 Grid Fixes...");
        const battleCss = `
            /* Fix Setup and Game Boards */
            .grid-container { display: flex !important; flex-wrap: wrap !important; width: 300px !important; height: 300px !important; align-content: flex-start !important; }
            /* Override generic .grid-container > * rule which might set margin: 10px */
            .grid-container > .cell { width: 10% !important; height: 10% !important; flex: none !important; margin: 0 !important; border: 1px solid #ccc; box-sizing: border-box; }
        `;
        finalHtml = finalHtml.replace('</style>', battleCss + '</style>');
    }

    // J. Settings (Pixel Drawer): Fix Grid
    if (finalHtml.includes('id="pixel-grid"')) {
        console.log("  [Settings] Injecting Pixel Grid Fixes...");
        const pixelCss = `
            #pixel-grid { display: flex !important; flex-wrap: wrap !important; width: 200px !important; height: 200px !important; gap: 0 !important; }
            .pixel { width: 12.5% !important; height: 12.5% !important; margin: 0 !important; border-top: 1px solid #eee; border-left: 1px solid #eee; box-sizing: border-box; flex-grow: 0 !important; max-width: none !important; }
        `;
        finalHtml = finalHtml.replace('</style>', pixelCss + '</style>');
    }

    // K. Memory: Fix Grid
    if (finalHtml.includes('<title>Memory</title>')) {
        console.log("  [Memory] Injecting Grid Fixes...");
        const memoryCss = `
            #game-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; }
            .card { width: 22% !important; margin: 1% !important; height: 90px !important; flex: none !important; }
        `;
        finalHtml = finalHtml.replace('</style>', memoryCss + '</style>');
    }

    // L. Mini Crossword: Fix 5x5 Grid
    if (finalHtml.includes('<title>Mini Crossword</title>')) {
        console.log("  [Mini Crossword] Injecting 5x5 Grid Fixes...");
        const miniCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 400px !important; height: auto !important; aspect-ratio: 1/1; gap: 0 !important; }
            .cell { width: 20% !important; height: 20% !important; margin: 0 !important; box-sizing: border-box; flex: none !important; border: 1px solid #999; }
        `;
        finalHtml = finalHtml.replace('</style>', miniCss + '</style>');
    }

    // M. Jigsaw: Fix Dynamic Grid
    if (finalHtml.includes('<title>Jigsaw</title>')) {
        console.log("  [Jigsaw] Injecting Flexbox & JS Patch...");
        const jigsawCss = `
            #puzzle-board { display: flex !important; flex-wrap: wrap !important; align-content: flex-start !important; }
            .piece { margin: 0 !important; box-sizing: border-box; flex: none !important; }
        `;
        finalHtml = finalHtml.replace('</style>', jigsawCss + '</style>');

        // Patch JS to set width/height
        finalHtml = finalHtml.replace(
            'div.style.backgroundPosition',
            "div.style.width = (100/gridSize) + '%'; div.style.height = (100/gridSize) + '%'; div.style.backgroundPosition"
        );
    }

    // N. Crossword (Standard): Fix Dynamic Grid
    if (finalHtml.includes('<title>Crossword</title>')) {
        console.log("  [Crossword] Injecting Flexbox & JS Patch...");
        const crossCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; align-content: flex-start !important; gap: 0 !important; }
            .cell { margin: 0 !important; box-sizing: border-box; flex: none !important; border: 1px solid #999; }
        `;
        finalHtml = finalHtml.replace('</style>', crossCss + '</style>');

        // Patch JS to set width/height
        finalHtml = finalHtml.replace(
            "cell.className = 'cell';",
            "cell.className = 'cell'; cell.style.width = (100/currentPuzzle.cols) + '%'; cell.style.height = (100/currentPuzzle.rows) + '%';"
        );
    }

    // O. Minesweeper: Fix Dynamic Grid
    if (finalHtml.includes('<title>Minesweeper</title>')) {
        console.log("  [Minesweeper] Injecting Flexbox & JS Patch...");
        const mineCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; align-content: flex-start !important; gap: 0 !important; }
            .cell { margin: 0 !important; box-sizing: border-box; flex: none !important; }
        `;
        finalHtml = finalHtml.replace('</style>', mineCss + '</style>');

        // Patch JS
        finalHtml = finalHtml.replace(
            "cell.className = 'cell';",
            "cell.className = 'cell'; cell.style.width = (100/COLS) + '%';"
        );
    }

    // P. Nerdle: Fix Flexbox Layout
    if (finalHtml.includes('<title>Nerdle</title>')) {
        console.log("  [Nerdle] Injecting Flexbox Layout fixes...");
        const nerdleCss = `
            #board-container { display: flex !important; flex-direction: column !important; gap: 4px !important; }
            .row { display: flex !important; width: 100% !important; justify-content: center !important; gap: 4px !important; }
            .tile { flex: 1 !important; margin: 0 !important; height: auto !important; aspect-ratio: 1/1 !important; }
        `;
        finalHtml = finalHtml.replace('</style>', nerdleCss + '</style>');
    }

    // Q. Nonograms: Fix Grid & Previews
    if (finalHtml.includes('<title>Nonograms</title>')) {
        console.log("  [Nonograms] Injecting Flexbox Layout fixes...");
        const nonoCss = `
            /* 1. Level Select Grid */
            .level-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; }
            .level-item { margin: 5px !important; flex: 0 0 90px !important; }
            
            /* 2. Game Grid */
            .nonogram-grid { display: flex !important; flex-wrap: wrap !important; }
            .cell { flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
        finalHtml = finalHtml.replace('</style>', nonoCss + '</style>');

        // Patch JS to set dynamic width for Nonogram cells
        // Target: "cell.className = 'cell';" or similar
        // In nonograms.html: "row.appendChild(cell);" is used in loops.
        // We can inject a helper or patch the loop.
        // Let's assume there's a loop that creates cells.
        // "cell.style.width" needs to be set.
        // We can hook into the render function if we can find a good anchor.
        // In renderGameGrid(): "const cell = document.createElement('div');"
        // Then: "gameGrid.style.gridTemplateColumns = ..." -> useless
        // We need to set cell width manually.
        // Let's replace "cell.className = 'cell';"
        // It appears twice? Let's check nonograms.html source from previous turn.
        // Line 369: .cell definition.
        // JS renderGameGrid (implied):
        // We can insert a style calculator.

        if (finalHtml.includes('function renderGameGrid()')) {
            finalHtml = finalHtml.replace(
                "cell.className = 'cell';",
                "cell.className = 'cell'; cell.style.width = (100/cols) + '%'; cell.style.height = (100/cols) + '%';"
            );
        }
    }

    // R. Scrabble (Words): Fix 15x15 Grid
    if (finalHtml.includes('<title>Scrabble</title>')) {
        console.log("  [Scrabble] Injecting Flexbox Layout fixes...");
        const scrabbleCss = `
            #board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; aspect-ratio: 1/1 !important; }
            .sq { width: 6.66% !important; height: 6.66% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
        finalHtml = finalHtml.replace('</style>', scrabbleCss + '</style>');
    }

    // S. Sudoku: Fix 9x9 Grid
    if (finalHtml.includes('<title>Sudoku</title>')) {
        console.log("  [Sudoku] Injecting Flexbox Layout fixes...");
        const sudokuCss = `
            #game-container { display: flex !important; flex-wrap: wrap !important; }
            .cell { width: 11.11% !important; height: 11.11% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
            
            /* Restore Borders for 3x3 Blocks manually if needed, or rely on existing nth-child if they work with flex items (they should) */
            /* Flex items are elements, so nth-child works fine. */
        `;
        finalHtml = finalHtml.replace('</style>', sudokuCss + '</style>');
    }


    // T. Tic-Tac-Toe (Classic & Ultimate): Fix Grid Layout
    if (finalHtml.includes('<title>Tic-Tac-Toe</title>')) {
        console.log("  [Tic-Tac-Toe] Injecting Flexbox Layout fixes...");
        const tttCss = `
            /* Container Overrides */
            .board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 380px !important; margin: 0 auto 20px auto !important; height: auto !important; }
            
            /* Classic Cells - 3x3 */
            .cell { width: 33.33% !important; height: 100px !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; }
            
            /* Ultimate Board */
            .u-board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 420px !important; margin: 0 auto 15px auto !important; padding: 4px !important; height: auto !important; box-sizing: border-box !important; }
            
            /* Ultimate Sub-boards 3x3 */
            .sub-board { width: 32% !important; margin: 0.5% !important; padding: 1px !important; box-sizing: border-box !important; flex: none !important; display: flex !important; flex-wrap: wrap !important; height: auto !important; }
            
            /* Ultimate Cells 3x3 */
            .sub-cell { width: 33.33% !important; height: 35px !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; }
        `;
        finalHtml = finalHtml.replace('</style>', tttCss + '</style>');
    }

    // U. Word Search: Fix Grid Layout
    if (finalHtml.includes('<title>Word Search</title>')) {
        console.log("  [Word Search] Injecting Flexbox Layout fixes...");
        const wsCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; gap: 0 !important; width: 100% !important; max-width: 550px !important; margin: 0 auto !important; height: auto !important; }
            .cell { width: 10% !important; height: 35px !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; border: 1px solid #ccc; font-size: 1.2rem !important; }
        `;
        finalHtml = finalHtml.replace('</style>', wsCss + '</style>');
    }

    // V. Wordle: Fix Grid Layout
    if (finalHtml.includes('<title>Wordle</title>')) {
        console.log("  [Wordle] Injecting Flexbox Layout fixes...");
        const wordleCss = `
            #board-container { display: flex !important; flex-direction: column !important; gap: 5px !important; height: 420px !important; }
            .row { display: flex !important; width: 100% !important; flex: 1 !important; gap: 5px !important; justify-content: center !important; grid-template-columns: none !important; }
            .tile { flex: 1 !important; margin: 0 !important; height: 100% !important; width: auto !important; }
            
            /* Keyboard Fixes */
            .key-row { display: flex !important; width: 100% !important; gap: 6px !important; justify-content: center !important; }
            .key { flex: 1 !important; }
            .key.big { flex: 1.5 !important; }
        `;
        finalHtml = finalHtml.replace('</style>', wordleCss + '</style>');
    }

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