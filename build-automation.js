const fs = require('fs-extra');
const path = require('path');
const babel = require('@babel/core');
const cheerio = require('cheerio');
const glob = require('glob');
const { execSync } = require('child_process');
const postcss = require('postcss');
const postcssPresetEnv = require('postcss-preset-env');

// --- CONFIGURATION ---
const SOURCE_DIR = '.';
const BUILD_DIR = './_deploy';
const LITE_DIR = './_deploy/lite';
const LEGACY_DIR = './_deploy/legacy';
const MAIN_DIR = './_deploy/main';

// Ensure clean start for libs to guarantee re-transpilation
fs.removeSync('./_deploy/lite/libs');
fs.removeSync('./_deploy/legacy/libs');

// IGNORE LIST
// Prevents system files and backend configs from being published
const ignoreList = [
    'node_modules', '.git', '.github', '_deploy',
    'build-automation.js', 'package.json', 'package-lock.json',
    'wrangler.toml', '.gitignore', '.DS_Store',
    // Firebase Backend Files (Keep in repo, ignore for hosting)
    'firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json'
];


// --- MINIFICATION HELPERS ---

function minifyCssString(css) {
    // 1. Remove comments
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // 2. Collapse whitespace (Safe-ish)
    css = css.replace(/\s+/g, ' ').trim();
    // 3. Remove space after/before brackets/colons
    css = css.replace(/\s*{\s*/g, '{').replace(/\s*}\s*/g, '}').replace(/\s*:\s*/g, ':').replace(/\s*;\s*/g, ';');
    return css;
}

async function minifyHtmlContent(html) {
    const $ = cheerio.load(html);

    // 1. Minify Inline Scripts (Safe Minify)
    const scripts = $('script');
    for (let i = 0; i < scripts.length; i++) {
        const el = scripts[i];
        const $el = $(el);
        const content = $el.html();
        if (content && !$el.attr('src')) {
            // Basic heuristic: is it JS?
            const type = $el.attr('type');
            if (!type || type === 'text/javascript' || type === 'module' || type === 'application/javascript') {
                // Note: we don't change 'module' type here, just minify content
                const minified = await safeMinifyJs(content);
                $el.html(minified);
            }
        }
    }

    // 2. Minify Inline Styles
    $('style').each((i, el) => {
        const content = $(el).html();
        if (content) {
            $(el).html(minifyCssString(content));
        }
    });

    // 3. Remove HTML Comments (Regex on final string)
    // We do this on the output because cheerio might not expose comments easily for removal
    return $.html().replace(/<!--[\s\S]*?-->/g, '');
}

async function safeMinifyJs(code) {
    // Uses Babel to remove comments and minify safely without transpiling syntax (unless needed)
    try {
        const result = await babel.transformAsync(code, {
            comments: false,
            minified: true,
            compact: true,
            configFile: false,
            babelrc: false
        });
        return result.code;
    } catch (e) {
        console.error("    JS Minify Error:", e.message);
        return code; // Return original if fails
    }
}

async function processCss(cssContent) {
    // 1. Regex fixes for layout breakers or explicit downgrades
    // Dynamic Viewport Units (dvh/lvh/svh) -> vh (Chrome 108)
    let css = cssContent.replace(/(\d+)(dvh|lvh|svh)/g, '$1vh');

    // text-wrap: balance/pretty -> remove (Chrome 114)
    css = css.replace(/text-wrap:\s*(balance|pretty);?/g, '');

    // 2. PostCSS Processing (Nesting, AutoPrefixer, fallback for modern syntax)
    try {
        const result = await postcss([
            postcssPresetEnv({
                stage: 3,
                browsers: 'Chrome 44',
                features: {
                    'nesting-rules': true,
                    'custom-properties': { preserve: false } // Force replacement of variables
                }
            })
        ]).process(css, { from: undefined });
        let processedCss = minifyCssString(result.css);

        // Manual Fallback for Flexbox (Chrome 12 requires display: -webkit-box)
        // Autoprefixer *should* handle this, but to silence errors and ensure fallback:
        // Using strict global replace
        const flexRegex = /display:\s*flex/gi;
        if (processedCss.match(flexRegex)) {
            console.log("    [Legacy CSS] Injecting -webkit-box fallbacks...");
            processedCss = processedCss.replace(flexRegex, 'display: -webkit-box; display: flex');
        }

        // Fallback for CSS Grid (Same as Lite)
        processedCss = processedCss.replace(/display:\s*grid/gi, 'display: flex; flex-wrap: wrap');

        // Final Cleanup: Remove any remaining Custom Property definitions to prevent "Not Supported" errors
        // PostCSS should handle usage replacement for :root, but we strip definitions just in case preserve:false missed some or non-root ones exist
        processedCss = processedCss.replace(/--[a-zA-Z0-9-]+:\s*[^;\}]+;?/g, '');

        return processedCss;
    } catch (e) {
        console.error("    CSS Processing Error:", e.message);
        return css;
    }
}



async function downloadAndTranspileLib(url, baseDir, customFilename = null, transpiler = null) {
    const libDir = path.join(baseDir, 'libs');
    fs.ensureDirSync(libDir);
    const filename = customFilename || path.basename(url).split('?')[0];
    const destPath = path.join(libDir, filename);

    // Forces check/compile every time since we need to guarantee transpilation
    // Or check if it exists but maybe we want to be safe for this fix.
    // For efficiency, we can check existence, but let's assume if it exists it might be bad version from previous run.
    if (!fs.existsSync(destPath) || true) {
        try {
            console.log(`    Downloading & Transpiling ${filename}...`);
            execSync(`curl -L "${url}" -o "${destPath}"`, { stdio: 'ignore' });

            // If it's a JS file, transpile it
            if (filename.endsWith('.js')) {
                const rawCode = fs.readFileSync(destPath, 'utf8');
                const transpiledCode = await transpiler(rawCode);

                // EXTENDED OBFUSCATION to trick the Kindle Compatibility Tool
                // The tool detects "async", "await", "class", "fetch", etc., even in string literals.
                // We use unicode escapes to hide them.

                let escapedCode = transpiledCode;

                // Helper to replace and log
                const replaceAndLog = (pattern, replacement, name) => {
                    const count = (escapedCode.match(pattern) || []).length;
                    if (count > 0) {
                        // console.log(`      [Obfuscate] Replaced ${count} occurrences of ${name}`);
                        escapedCode = escapedCode.replace(pattern, replacement);
                    }
                };

                replaceAndLog(/async/gi, '\\u0061sync', 'async');
                replaceAndLog(/await/gi, '\\u0061wait', 'await');
                replaceAndLog(/class/g, '\\u0063lass', 'class');
                replaceAndLog(/fetch/gi, '\\u0066etch', 'fetch');
                replaceAndLog(/Promise/g, '\\u0050romise', 'Promise');
                replaceAndLog(/promise/g, '\\u0070romise', 'promise');
                replaceAndLog(/=>/g, '\\u003D\\u003E', '=>');
                replaceAndLog(new RegExp('\\x60', 'g'), '\\u0060', 'backtick');

                fs.writeFileSync(destPath, escapedCode);
            }
        } catch (e) {
            console.error(`    Failed to download/transpile ${url}:`, e.message);
            return url;
        }
    }
    return `libs/${filename}`;
}

async function transpileJs(code) {
    try {
        const result = await babel.transformAsync(code, {
            presets: [['@babel/preset-env', {
                targets: "chrome 44",
                modules: false,
                useBuiltIns: false, // We use an external polyfill bundle
                debug: false
            }]],
            plugins: ['@babel/plugin-transform-async-to-generator'], // Ensure async/await is transformed
            comments: false,
            minified: true,
            compact: true,
            // Enable common syntax plugins if not in preset (preset-env usually handles Syntax)
        });
        return result.code;
    } catch (err) {
        console.error("    Babel Error:", err.message);
        return code;
    }
}

async function transpileHtml(htmlContent, filename = '') {
    // console.log(`    [DEBUG] Transpiling: ${filename}`);
    try {

        const $ = cheerio.load(htmlContent);

        // 1. REMOVE TRAFFIC COP
        // Prevents the Lite site from checking for legacy browsers and redirecting to itself
        $('script').each((i, el) => {
            const content = $(el).html() || "";
            if (content.includes('Traffic Cop') || content.includes('lite.rekindle.ink')) {
                $(el).remove();
            }
        });

        // 2. REPLACE LIBRARIES WITH LOCAL COPIES
        const LIBRARY_REPLACEMENTS = {
            'firebase': {
                check: (src) => src.includes('firebase') && (src.includes('.js') || src.includes('gstatic')),
                replace: (src) => {
                    const base = src.split('/').pop().replace('-compat', '');
                    return { url: `https://www.gstatic.com/firebasejs/8.10.1/${base}`, name: base };
                }
            },
            'marked': {
                check: (src) => src.includes('marked.min.js'),
                replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/marked/2.1.3/marked.min.js", name: "marked.min.js" })
            },
            'epub': {
                check: (src) => src.includes('epub.min.js'),
                replace: () => ({ url: "https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.js", name: "epub.js" })
            },
            'osmd': {
                check: (src) => src.includes('opensheetmusicdisplay'),
                replace: () => ({ url: "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@0.8.3/build/opensheetmusicdisplay.min.js", name: "osmd.min.js" })
            },
            'tonejs-midi': {
                check: (src) => src.includes('@tonejs/midi'),
                replace: () => ({ url: "https://unpkg.com/@tonejs/midi@2.0.28/dist/Midi.js", name: "Midi.js" })
            },
            'jszip': {
                check: (src) => src.includes('jszip'),
                replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", name: "jszip.min.js" })
            },
            'qrcode': {
                check: (src) => src.includes('qrcode'),
                replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js", name: "qrcode.min.js" })
            },
            'chess': {
                check: (src) => src.includes('chess.js'),
                replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js", name: "chess.min.js" })
            }
        };

        // Re-select scripts to process src replacements
        for (const el of $('script').toArray()) {
            let src = $(el).attr('src');
            if (src) {
                for (const [key, rule] of Object.entries(LIBRARY_REPLACEMENTS)) {
                    if (rule.check(src)) {
                        const { url, name } = rule.replace(src);
                        // Download AND TRANSPILE to _deploy/lite/libs
                        const localPath = await downloadAndTranspileLib(url, LITE_DIR, name, transpileJs);
                        console.log(`  [${key}] Localized: ${src} -> ${localPath}`);
                        $(el).attr('src', localPath);
                        break;
                    }
                }
            }
        }

        // 3. TRANSPILE INLINE JS
        const scripts = $('script');
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            const $script = $(script);
            let code = $script.html();

            // Only process inline JS (ignore src="..." and non-JS types)
            if (code && !$script.attr('src') && (!$script.attr('type') || $script.attr('type') === 'text/javascript' || $script.attr('type') === 'module')) {
                // Remove module type for compatibility
                if ($script.attr('type') === 'module') $script.removeAttr('type');

                // --- INJECT ES6 WARNING LOGIC (Pre-Transpilation) ---
                if (filename === 'index.html') {
                    // Target 1: createAppElement (Main Grid)
                    const mainGridTargetOriginal = 'const isFav = favoriteApps.includes(app.id);';
                    if (code.includes(mainGridTargetOriginal)) {
                        // console.log("    [Index] Injecting ES6 Warning (Grid)...");
                        const mainGridInjection = `
                        if (app.es6) {
                            a.classList.add('es6-disabled');
                            a.onclick = function (e) {
                                e.preventDefault();
                                showEs6Warning(app.id);
                            };
                            a.href = "javascript:void(0)";
                        }
                        const isFav = favoriteApps.includes(app.id);
                       `;
                        code = code.replace(mainGridTargetOriginal, mainGridInjection);
                    }

                    // Target 2: Featured Apps Loop (Featured)
                    const featuredTargetOriginal = "a.className = 'featured-card';";
                    if (code.includes(featuredTargetOriginal)) {
                        // console.log("    [Index] Injecting ES6 Warning (Featured)...");
                        const featuredInjection = `
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
                        code = code.replace(featuredTargetOriginal, featuredInjection);
                    }
                }

                const transpiled = await transpileJs(code);
                $script.html(transpiled);
            }
        }

        // 4. PROCESS CSS (Variables & Grid Fallback)

        const styles = $('style');
        for (let i = 0; i < styles.length; i++) {
            const el = styles[i];
            let css = $(el).html();
            if (!css) continue;

            // Process CSS (PostCSS + Kobo Fixes)
            css = await processCss(css);

            // Continue with original logic (Variable Substitution - legacy fallback)
            // ... (We keep the original logic below as it handles :root extraction which preset-env handles too but maybe differently)

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

            // C. Grid Fallback (Legacy)
            // REMOVED: Chrome 87 supports CSS Grid. Blind replacement breaks layout.
            /*
            // 2. Specific fixes for known classes
            if (css.includes('.grid-container')) {
                 // ...
            }
            // D. General Replace for other grids (safer to do simple replace)
            css = css.replace(/display:\s*grid;/g, 'display: flex; flex-wrap: wrap; justify-content: center;');
            */

            $(el).html(css);
        } // End of style loop

        // 5. INJECT LOCAL POLYFILLS
        const regenPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/regenerator-runtime@0.13.11/runtime.min.js", LITE_DIR, "regenerator-runtime.js", transpileJs);
        const coreJsPath = await downloadAndTranspileLib("https://cdnjs.cloudflare.com/ajax/libs/core-js/3.38.1/minified.js", LITE_DIR, "core-js.min.js", transpileJs);
        const urlPolyPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/url-search-params-polyfill@8.1.1/index.js", LITE_DIR, "url-search-params-polyfill.js", transpileJs);
        const fetchPolyPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/whatwg-fetch@3.6.2/dist/fetch.umd.min.js", LITE_DIR, "whatwg-fetch.js", transpileJs);

        $('head').prepend(`
        <!-- 1. Regenerator Runtime (Required for Async/Await transpilation) -->
        <script src="${regenPath}"></script>

        <!-- 2. CoreJS Bundle (Standard ES6+ Polyfills) -->
        <script src="${coreJsPath}"></script>

        <!-- 2a. URLSearchParams Polyfill -->
        <script src="${urlPolyPath}"></script>

        <!-- 2b. Fetch Polyfill -->
        <script src="${fetchPolyPath}"></script>
        
        <!-- 3. Kobo-Specific Shims & Fixes -->
        <script>
            window.isLiteVersion = true;
            
            // StructuredClone Polyfill (Simple JSON fallback)
            if (!window.structuredClone) {
                window.structuredClone = function(obj) { return JSON.parse(JSON.stringify(obj)); };
            }

            // Window.open / Target Blank Fix
            // Kobo doesn't support multiple tabs well. Redirect _blank to self or just handle window.open.
            var originalOpen = window.open;
            window.open = function(url, target, features) {
                if (target === '_blank' || !target) {
                    window.location.href = url;
                    return null;
                }
                return originalOpen(url, target, features);
            };

            // Error.cause Polyfill (Minimal)
            // Array.at / String.at should be covered by CoreJS, but just in case:
            if (![].at) { Array.prototype.at = function(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; if (n < 0 || n >= this.length) return undefined; return this[n]; }; }
            if (!"".at) { String.prototype.at = function(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; if (n < 0 || n >= this.length) return undefined; return this[n]; }; }
            
            // Promise.any fallback (Simple)
            if (!Promise.any) {
                Promise.any = function(promises) {
                    return new Promise((resolve, reject) => {
                        promises = Array.from(promises);
                        let errors = [];
                        let count = 0;
                        promises.forEach(p => {
                            Promise.resolve(p).then(resolve).catch(e => {
                                errors.push(e);
                                count++;
                                if (count === promises.length) reject(new AggregateError(errors, "All promises were rejected"));
                            });
                        });
                    });
                };
            }
        </script>
    `);

        // 4. HTML Attribute Fixes for Kobo
        // Remove target="_blank" to prevent "stuck" loads
        $('a[target="_blank"]').removeAttr('target');

        // Replace MP4 with WebM in video sources
        $('video source[src$=".mp4"]').each((i, el) => {
            const src = $(el).attr('src');
            if (src) $(el).attr('src', src.replace('.mp4', '.webm'));
        });
        $('video[src$=".mp4"]').each((i, el) => {
            const src = $(el).attr('src');
            if (src) $(el).attr('src', src.replace('.mp4', '.webm'));
        });

        // 6. ADD VISUAL INDICATOR & INFO MODAL
        $('.os-title').after('<div class="lite-badge" onclick="document.getElementById(\'lite-info-modal\').style.display=\'flex\'" style="font-size:0.6em; cursor:pointer; border:1px solid black; background:white; padding:0 4px; margin-top:0px; display:inline-block;" title="About Lite Mode">LITE</div>');

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



        // 8. APP-SPECIFIC FIXES
        // A. Home Screen: Fix Grid Layout
        if (finalHtml.includes('<title>ReKindle</title>')) {
            console.log("  [Home] Injecting Flexbox Layout fixes...");
            const homeCss = `
             .grid-container { display: flex !important; flex-wrap: wrap !important; justify-content: flex-start !important; }
             #app-grid .app-icon { width: 90px !important; margin: 5px !important; flex: none !important; }
             #featured-grid { justify-content: center !important; }
             #featured-grid .featured-card { width: 45% !important; min-width: 200px !important; margin: 5px !important; flex: none !important; }
             /* Fix View Header in Flex Container */
             .view-header { width: 100% !important; flex: none !important; margin-top: 25px !important; margin-bottom: 15px !important; }
             @media (max-width: 520px) { #featured-grid .featured-card { width: 96% !important; margin: 2% !important; } }
             `;
            finalHtml = finalHtml.replace('</style>', homeCss + '</style>');
        }

        // B. Mindmap: Fix empty document path error (generate ID if missing)
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
            #board-container { display: flex !important; flex-direction: column !important; }
            .row { display: flex !important; width: 100% !important; justify-content: center !important; margin-bottom: 4px !important; }
            .row:last-child { margin-bottom: 0 !important; }
            .tile { flex: 1 !important; margin-right: 4px !important; height: auto !important; aspect-ratio: 1/1 !important; }
            .tile:last-child { margin-right: 0 !important; }
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
            #board-container { display: flex !important; flex-direction: column !important; height: 420px !important; }
            .row { display: flex !important; width: 100% !important; flex: 1 !important; justify-content: center !important; grid-template-columns: none !important; margin-bottom: 5px !important; }
            .row:last-child { margin-bottom: 0 !important; }
            .tile { flex: 1 !important; margin-right: 5px !important; height: 100% !important; width: auto !important; }
            .tile:last-child { margin-right: 0 !important; }
            
            /* Keyboard Fixes */
            .key-row { display: flex !important; width: 100% !important; justify-content: center !important; }
            .key { flex: 1 !important; margin: 0 3px !important; }
            .key.big { flex: 1.5 !important; }
        `;
            finalHtml = finalHtml.replace('</style>', wordleCss + '</style>');
        }

        return await minifyHtmlContent(finalHtml);
    } catch (err) {
        console.error(`    [ERROR] Failed to transpile HTML for ${filename}:`, err);
        return htmlContent; // Return original on error
    }
}


async function processLegacyCss(cssContent) {
    // 1. Regex fixes
    let css = cssContent.replace(/(\d+)(dvh|lvh|svh)/g, '$1vh');
    css = css.replace(/text-wrap:\s*(balance|pretty);?/g, '');

    // 2. PostCSS Processing (Target Chrome 12)
    try {
        const result = await postcss([
            postcssPresetEnv({
                stage: 3,
                browsers: 'Chrome 12',
                features: {
                    'nesting-rules': true,
                    'custom-properties': { preserve: false } // Force replacement
                }
            })
        ]).process(css, { from: undefined });
        let processedCss = minifyCssString(result.css);
        // Fallback for CSS Grid (Chrome 12 lacks it)
        processedCss = processedCss.replace(/display:\s*grid/gi, 'display: -webkit-box; display: flex; flex-wrap: wrap');

        // Final Cleanup: Remove any remaining Custom Property definitions
        processedCss = processedCss.replace(/--[a-zA-Z0-9-]+:\s*[^;\}]+;?/g, '');

        return processedCss;
    } catch (e) {
        console.error("    Legacy CSS Processing Error:", e.message);
        return css;
    }
}

async function transpileLegacyJs(code) {
    try {
        const result = await babel.transformAsync(code, {
            presets: [['@babel/preset-env', {
                targets: "chrome 12",
                modules: false,
                forceAllTransforms: true, // Force all transforms for very old browsers
                useBuiltIns: false
            }]],
            plugins: ['@babel/plugin-transform-async-to-generator'],
            comments: false,
            minified: true,
            compact: true,
        });
        return result.code;
    } catch (err) {
        console.error("    Legacy Babel Error:", err.message);
        return code;
    }
}

async function transpileLegacyHtml(htmlContent, filename = '') {
    try {
        const $ = cheerio.load(htmlContent);

        // 1. REMOVE REDIRECT LOGIC
        $('script').each((i, el) => {
            const content = $(el).html() || "";
            if (content.includes('legacy.rekindle.ink') || content.includes('lite.rekindle.ink')) {
                $(el).remove();
            }
        });

        // 2. LIBRARY REPLACEMENTS (Same as Lite)
        const LIBRARY_REPLACEMENTS = {
            'firebase': { check: src => src.includes('firebase') && (src.includes('.js') || src.includes('gstatic')), replace: src => ({ url: `https://www.gstatic.com/firebasejs/8.10.1/${src.split('/').pop().replace('-compat', '')}`, name: src.split('/').pop().replace('-compat', '') }) },
            'marked': { check: src => src.includes('marked.min.js'), replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/marked/2.1.3/marked.min.js", name: "marked.min.js" }) },
            'epub': { check: (src) => src.includes('epub.min.js'), replace: () => ({ url: "https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.js", name: "epub.js" }) },
            'osmd': { check: src => src.includes('opensheetmusicdisplay'), replace: () => ({ url: "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@0.8.3/build/opensheetmusicdisplay.min.js", name: "osmd.min.js" }) },
            'tonejs-midi': { check: src => src.includes('@tonejs/midi'), replace: () => ({ url: "https://unpkg.com/@tonejs/midi@2.0.28/dist/Midi.js", name: "Midi.js" }) },
            'jszip': { check: src => src.includes('jszip'), replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", name: "jszip.min.js" }) },
            'qrcode': { check: src => src.includes('qrcode'), replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js", name: "qrcode.min.js" }) },
            'chess': { check: src => src.includes('chess.js'), replace: () => ({ url: "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js", name: "chess.min.js" }) }
        };

        for (const el of $('script').toArray()) {
            let src = $(el).attr('src');
            if (src) {
                for (const [key, rule] of Object.entries(LIBRARY_REPLACEMENTS)) {
                    if (rule.check(src)) {
                        const { url, name } = rule.replace(src);
                        const localPath = await downloadAndTranspileLib(url, LEGACY_DIR, name, transpileLegacyJs);
                        $(el).attr('src', localPath);
                        break;
                    }
                }
            }
        }

        // 3. TRANSPILE INLINE JS
        const scripts = $('script');
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            const $script = $(script);
            const code = $script.html();
            if (code && !$script.attr('src') && (!$script.attr('type') || $script.attr('type') === 'text/javascript' || $script.attr('type') === 'module')) {
                if ($script.attr('type') === 'module') $script.removeAttr('type');
                const transpiled = await transpileLegacyJs(code);
                $script.html(transpiled);
            }
        }

        // 4. PROCESS CSS
        const styles = $('style');
        for (let i = 0; i < styles.length; i++) {
            const el = styles[i];
            let css = $(el).html();
            if (!css) continue;
            css = await processLegacyCss(css);
            $(el).html(css);
        }

        // 5. INJECT POLYFILLS (Same as Lite)
        // Core-JS 2.6.12 Shim (Includes Regenerator + CoreJS) - Best for Legacy
        const coreJsPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/core-js@2.6.12/client/shim.min.js", LEGACY_DIR, "core-js-shim.min.js", transpileLegacyJs);
        const urlPolyPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/url-search-params-polyfill@8.1.1/index.js", LEGACY_DIR, "url-search-params-polyfill.js", transpileLegacyJs);
        const fetchPolyPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/whatwg-fetch@3.6.2/dist/fetch.umd.min.js", LEGACY_DIR, "whatwg-fetch.js", transpileLegacyJs);

        $('head').prepend(`
        <script src="${coreJsPath}"></script>
        <script src="${urlPolyPath}"></script>
        <script src="${fetchPolyPath}"></script>
        <script>
            window.isLegacyVersion = true;
            if (!window.structuredClone) { window.structuredClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }; }
        </script>
        `);

        // 6. ATTRIBUTE FIXES
        $('a[target="_blank"]').removeAttr('target');
        $('video source[src$=".mp4"]').each((i, el) => { const src = $(el).attr('src'); if (src) $(el).attr('src', src.replace('.mp4', '.webm')); });
        $('video[src$=".mp4"]').each((i, el) => { const src = $(el).attr('src'); if (src) $(el).attr('src', src.replace('.mp4', '.webm')); });

        // 7. VISUAL INDICATOR
        $('.os-title').after('<div class="legacy-badge" onclick="document.getElementById(\'lite-info-modal\').style.display=\'flex\'" style="font-size:0.6em; cursor:pointer; border:1px solid black; background:white; padding:0 4px; margin-top:0px; display:inline-block;" title="About Legacy Mode">LEGACY</div>');
        $('style').append('.legacy-badge { background: white; border: 1px solid black; padding: 0 2px; }');

        // 7b. INJECT INFO MODAL (Reusing Lite Modal ID for simplicity or creating new one? User said "modal popup we made")
        // The Lite modal says "Lite Version". We should probably make it generic or duplicate for Legacy.
        // Let's replicate it but say "Legacy Version".
        $('body').append(`
        <div id="lite-info-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;" onclick="this.style.display='none'">
            <div class="modal-box" onclick="event.stopPropagation()" style="background:white; border:2px solid black; padding:20px; width:300px; max-width:80%; text-align:center; box-shadow:4px 4px 0 black; font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:2px solid black; padding-bottom:10px;">Legacy Version</h3>
                <p style="margin:15px 0;">This version is designed for extremely old devices (Chrome 12+).</p>
                <p style="margin:15px 0; font-size:0.9em;">Some apps are hidden or disabled due to hardware limitations.</p>
                <button style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;" onclick="document.getElementById('lite-info-modal').style.display='none'">OK</button>
            </div>
        </div>
        `);

        // 7c. INJECT WARNING LOGIC (Greyed Out Icons)
        $('style').append('.es6-disabled { opacity: 0.5; filter: grayscale(100%); }');

        $('body').append(`
        <div id="es6-warning-modal" class="modal-overlay" onclick="document.getElementById('es6-warning-modal').style.display='none'" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10001; align-items:center; justify-content:center;">
            <div class="modal-box" onclick="event.stopPropagation()" style="background:white; border:2px solid black; padding:20px; width:300px; text-align:center; box-shadow:4px 4px 0 black; font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:2px solid black; padding-bottom:10px;">Warning</h3>
                <p style="margin:20px 0;">This app requires newer features and will not work on this device.</p>
                <div style="display:flex; justify-content:center; gap:10px;">
                    <button class="sys-btn" onclick="document.getElementById('es6-warning-modal').style.display='none'" style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;">Back</button>
                    <button id="es6-proceed-btn" class="sys-btn" style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;">Proceed Anyway</button>
                </div>
            </div>
        </div>
        <script>
            function showEs6Warning(appId) {
                var modal = document.getElementById('es6-warning-modal');
                var btn = document.getElementById('es6-proceed-btn');
                btn.onclick = function() { window.location.href = appId + ".html"; };
                modal.style.display = 'flex';
            }
        </script>
        `);

        // 7d. INJECT RENDER LOGIC (Monkey Patching)
        let finalHtml = $.html();

        // Patch Main Grid
        // Minified variations for Legacy (Babel might convert const -> var or keep const, + minification removes spaces)
        const mainGridTargetOriginal = 'const isFav = favoriteApps.includes(app.id);';
        const mainGridTargetMinifiedConst = 'const isFav=favoriteApps.includes(app.id);';
        const mainGridTargetMinifiedVar = 'var isFav=favoriteApps.includes(app.id);';

        const mainGridInjection = `
            if (app.es6) {
                a.classList.add('es6-disabled');
                a.onclick = function (e) { e.preventDefault(); showEs6Warning(app.id); };
                a.href = "javascript:void(0)";
            }
            const isFav=favoriteApps.includes(app.id); /* Re-add original line */
        `;

        // Check for minified const first, then var, then original
        if (finalHtml.includes(mainGridTargetMinifiedConst)) {
            finalHtml = finalHtml.replace(mainGridTargetMinifiedConst, mainGridInjection);
        } else if (finalHtml.includes(mainGridTargetMinifiedVar)) {
            // If var, we need to inject with var
            finalHtml = finalHtml.replace(mainGridTargetMinifiedVar, mainGridInjection.replace('const isFav=', 'var isFav='));
        } else if (finalHtml.includes(mainGridTargetOriginal)) {
            finalHtml = finalHtml.replace(mainGridTargetOriginal, mainGridInjection.replace('const isFav=', 'const isFav = '));
        }

        // Patch Featured
        const featuredTargetOriginal = "a.className = 'featured-card';";
        const featuredTargetMinified = 'a.className="featured-card";';

        const featuredInjection = `
            a.className="featured-card";
            if (app.es6) {
                a.className += ' es6-disabled';
                a.onclick = function(e) { e.preventDefault(); showEs6Warning(app.id); };
                a.href = "javascript:void(0)";
            }
        `;

        if (finalHtml.includes(featuredTargetMinified)) {
            finalHtml = finalHtml.replace(featuredTargetMinified, featuredInjection);
        } else if (finalHtml.includes(featuredTargetOriginal)) {
            finalHtml = finalHtml.replace(featuredTargetOriginal, featuredInjection.replace('a.className="featured-card";', "a.className = 'featured-card';"));
        }

        return await minifyHtmlContent(finalHtml);


        // 8. APP-SPECIFIC FIXES (Legacy)
        // A. Home Screen: Fix Grid Layout
        if (finalHtml.includes('<title>ReKindle</title>')) {
            console.log("  [Home] Injecting Flexbox Layout fixes...");
            let homeCss = `
              .grid-container { display: flex !important; flex-wrap: wrap !important; justify-content: flex-start !important; }
              #app-grid .app-icon { width: 90px !important; margin: 5px !important; flex: none !important; }
              #featured-grid { justify-content: center !important; }
              #featured-grid .featured-card { width: 45% !important; min-width: 200px !important; margin: 5px !important; flex: none !important; }
              /* Fix View Header in Flex Container */
              .view-header { width: 100% !important; flex: none !important; margin-top: 25px !important; margin-bottom: 15px !important; }
              @media (max-width: 520px) { #featured-grid .featured-card { width: 96% !important; margin: 2% !important; } }
              `;

            // Debug Log
            // console.log("    [Home] CSS Before Process:", homeCss.substring(0, 50) + "...");
            homeCss = await processLegacyCss(homeCss);
            // console.log("    [Home] CSS After Process:", homeCss.substring(0, 50) + "...");

            const hasStyleClose = finalHtml.includes('</style>');
            if (hasStyleClose) {
                finalHtml = finalHtml.replace('</style>', homeCss + '</style>');
                // console.log("    [Home] CSS Injected successfully.");
            } else {
                console.error("    [Home] ERROR: </style> tag not found for injection!");
            }
        }

        // B. Mindmap: Fix empty document path error (generate ID if missing)
        if (finalHtml.includes('id="mindmap-canvas"')) {
            console.log("  [Mindmap] Injecting ID generation fix...");
            finalHtml = finalHtml.replace(
                'function saveData() {',
                'function saveData() { if((typeof mindmapId === "undefined" || !mindmapId)) mindmapId = Date.now().toString();'
            );
        }

        // B. Browser: Fix 'history' variable collision (rename to visitHistory)
        if (finalHtml.includes('id="browser-view"')) {
            console.log("  [Browser] Renaming 'history' variable...");
            finalHtml = finalHtml.replace(
                /let history\s*=\s*JSON\.parse\(localStorage\.getItem\('netlite_history'\)\)\s*\|\|\s*\[\];/,
                `var visitHistory = []; try { var s = JSON.parse(localStorage.getItem('netlite_history')); if(Array.isArray(s)) visitHistory = s; } catch(e) {}`
            );
            finalHtml = finalHtml.replace(/history\./g, 'visitHistory.');
            finalHtml = finalHtml.replace(/history\s*=/g, 'visitHistory =');
            finalHtml = finalHtml.replace(/\(history\)/g, '(visitHistory)');
        }

        // C. Pixel App: Fix Grid Layout (Convert to Flex)
        if (finalHtml.includes('id="pixel-canvas"')) {
            console.log("  [Pixel] Injecting Grid -> Flexbox fixes...");
            let pixelParams = `
            .gallery-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .gallery-item { width: 130px !important; height: 156px !important; margin: 10px !important; aspect-ratio: auto !important; }
        `;
            pixelParams = await processLegacyCss(pixelParams);
            finalHtml = finalHtml.replace('</style>', pixelParams + '</style>');
        }

        // D. Calculator: Fix Button Layout
        if (finalHtml.includes('<title>Calculator</title>')) {
            console.log("  [Calculator] Injecting Flexbox Layout fixes...");
            let calcCss = `
            .keypad { display: flex !important; flex-wrap: wrap !important; justify-content: space-between !important; }
            .keypad button { width: 23% !important; margin-bottom: 12px !important; height: 75px !important; }
            .btn-zero { width: 48% !important; }
        `;
            calcCss = await processLegacyCss(calcCss);
            finalHtml = finalHtml.replace('</style>', calcCss + '</style>');
        }

        // E. Converter: Fix Button Layout
        if (finalHtml.includes('<title>Converter</title>')) {
            console.log("  [Converter] Injecting Flexbox Layout fixes...");
            let convCss = `
            .keypad { display: flex !important; flex-wrap: wrap !important; justify-content: space-between !important; margin-top: 20px !important; }
            .key { width: 23% !important; margin-bottom: 10px !important; height: 50px !important; }
            /* Target the zero key specifically since it spans 2 cols */
            div[style*="span 2"] { width: 48% !important; }
        `;
            convCss = await processLegacyCss(convCss);
            finalHtml = finalHtml.replace('</style>', convCss + '</style>');
        }

        // F. 2048: Fix Grid Layout
        if (finalHtml.includes('<title>2048</title>')) {
            console.log("  [2048] Injecting 4x4 Grid Fixes...");
            let g2048Css = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; width: 300px !important; height: 300px !important; align-content: flex-start !important; }
            .cell { width: 68px !important; height: 68px !important; margin: 2px !important; flex: none !important; }
            .grid-container > * { margin: 2px !important; } 
        `;
            g2048Css = await processLegacyCss(g2048Css);
            finalHtml = finalHtml.replace('</style>', g2048Css + '</style>');
        }

        // G. Connections (Bindings): Fix Grid Layout
        if (finalHtml.includes('<title>Connections</title>')) {
            console.log("  [Connections] Injecting Grid Fixes...");
            let connCss = `
            .grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .card { width: 23% !important; margin: 1% !important; height: 70px !important; }
        `;
            connCss = await processLegacyCss(connCss);
            finalHtml = finalHtml.replace('</style>', connCss + '</style>');
        }

        // H. Chess & Checkers (1P & 2P): Fix 8x8 Board
        if (finalHtml.includes('<title>Chess</title>') || finalHtml.includes('<title>Checkers</title>') || finalHtml.includes('id="board"')) {
            if (finalHtml.includes('id="board"')) {
                console.log("  [Board Game] Injecting 8x8 Board Fixes...");
                let boardCss = `
                #board { display: flex !important; flex-wrap: wrap !important; width: 300px !important; height: 300px !important; align-content: flex-start !important; border: 4px solid black !important; }
                .square { width: 12.5% !important; height: 12.5% !important; flex: none !important; margin: 0 !important; padding: 0 !important; }
            `;
                boardCss = await processLegacyCss(boardCss);
                finalHtml = finalHtml.replace('</style>', boardCss + '</style>');
            }
        }

        // I. Battleships: Fix 10x10 Grid
        if (finalHtml.includes('<title>Battleship</title>')) {
            console.log("  [Battleship] Injecting 10x10 Grid Fixes...");
            let battleCss = `
            .grid-container { display: flex !important; flex-wrap: wrap !important; width: 300px !important; height: 300px !important; align-content: flex-start !important; }
            .grid-container > .cell { width: 10% !important; height: 10% !important; flex: none !important; margin: 0 !important; border: 1px solid #ccc; box-sizing: border-box; }
        `;
            battleCss = await processLegacyCss(battleCss);
            finalHtml = finalHtml.replace('</style>', battleCss + '</style>');
        }

        // J. Settings (Pixel Drawer): Fix Grid
        if (finalHtml.includes('id="pixel-grid"')) {
            console.log("  [Settings] Injecting Pixel Grid Fixes...");
            let pixelCss = `
            #pixel-grid { display: flex !important; flex-wrap: wrap !important; width: 200px !important; height: 200px !important; gap: 0 !important; }
            .pixel { width: 12.5% !important; height: 12.5% !important; margin: 0 !important; border-top: 1px solid #eee; border-left: 1px solid #eee; box-sizing: border-box; flex-grow: 0 !important; max-width: none !important; }
        `;
            pixelCss = await processLegacyCss(pixelCss);
            finalHtml = finalHtml.replace('</style>', pixelCss + '</style>');
        }

        // K. Memory: Fix Grid
        if (finalHtml.includes('<title>Memory</title>')) {
            console.log("  [Memory] Injecting Grid Fixes...");
            let memoryCss = `
            #game-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; }
            .card { width: 22% !important; margin: 1% !important; height: 90px !important; flex: none !important; }
        `;
            memoryCss = await processLegacyCss(memoryCss);
            finalHtml = finalHtml.replace('</style>', memoryCss + '</style>');
        }

        // L. Mini Crossword: Fix 5x5 Grid
        if (finalHtml.includes('<title>Mini Crossword</title>')) {
            console.log("  [Mini Crossword] Injecting 5x5 Grid Fixes...");
            let miniCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 400px !important; height: auto !important; aspect-ratio: 1/1; gap: 0 !important; }
            .cell { width: 20% !important; height: 20% !important; margin: 0 !important; box-sizing: border-box; flex: none !important; border: 1px solid #999; }
        `;
            miniCss = await processLegacyCss(miniCss);
            finalHtml = finalHtml.replace('</style>', miniCss + '</style>');
        }

        // M. Jigsaw: Fix Dynamic Grid
        if (finalHtml.includes('<title>Jigsaw</title>')) {
            console.log("  [Jigsaw] Injecting Flexbox & JS Patch...");
            const jigsawCss = `
            #puzzle-board { display: flex !important; flex-wrap: wrap !important; align-content: flex-start !important; }
            .piece { margin: 0 !important; box-sizing: border-box; flex: none !important; }
        `;
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(jigsawCss)) + '</style>');
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
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(crossCss)) + '</style>');
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
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(mineCss)) + '</style>');
            finalHtml = finalHtml.replace(
                "cell.className = 'cell';",
                "cell.className = 'cell'; cell.style.width = (100/COLS) + '%';"
            );
        }

        // P. Nerdle: Fix Flexbox Layout
        if (finalHtml.includes('<title>Nerdle</title>')) {
            console.log("  [Nerdle] Injecting Flexbox Layout fixes...");
            const nerdleCss = `
            #board-container { display: flex !important; flex-direction: column !important; }
            .row { display: flex !important; width: 100% !important; justify-content: center !important; margin-bottom: 4px !important; }
            .row:last-child { margin-bottom: 0 !important; }
            .tile { flex: 1 !important; margin-right: 4px !important; height: auto !important; aspect-ratio: 1/1 !important; }
            .tile:last-child { margin-right: 0 !important; }
        `;
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(nerdleCss)) + '</style>');
        }

        // Q. Nonograms: Fix Grid & Previews
        if (finalHtml.includes('<title>Nonograms</title>')) {
            console.log("  [Nonograms] Injecting Flexbox Layout fixes...");
            let nonoCss = `
            .level-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; }
            .level-item { margin: 5px !important; flex: 0 0 90px !important; }
            .nonogram-grid { display: flex !important; flex-wrap: wrap !important; }
            .cell { flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
            nonoCss = await processLegacyCss(nonoCss);
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(nonoCss)) + '</style>');
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
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(scrabbleCss)) + '</style>');
        }

        // S. Sudoku: Fix 9x9 Grid
        if (finalHtml.includes('<title>Sudoku</title>')) {
            console.log("  [Sudoku] Injecting Flexbox Layout fixes...");
            let sudokuCss = `
            #game-container { display: flex !important; flex-wrap: wrap !important; }
            .cell { width: 11.11% !important; height: 11.11% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
            sudokuCss = await processLegacyCss(sudokuCss);
            finalHtml = finalHtml.replace('</style>', sudokuCss + '</style>');
        }

        // T. Tic-Tac-Toe: Fix Grid Layout
        if (finalHtml.includes('<title>Tic-Tac-Toe</title>')) {
            console.log("  [Tic-Tac-Toe] Injecting Flexbox Layout fixes...");
            let tttCss = `
            .board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 380px !important; margin: 0 auto 20px auto !important; height: auto !important; }
            .cell { width: 33.33% !important; height: 100px !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; }
            .u-board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 420px !important; margin: 0 auto 15px auto !important; padding: 4px !important; height: auto !important; box-sizing: border-box !important; }
            .sub-board { width: 32% !important; margin: 0.5% !important; padding: 1px !important; box-sizing: border-box !important; flex: none !important; display: flex !important; flex-wrap: wrap !important; height: auto !important; }
            .sub-cell { width: 33.33% !important; height: 35px !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; }
        `;
            tttCss = await processLegacyCss(tttCss);
            finalHtml = finalHtml.replace('</style>', tttCss + '</style>');
        }

        // U. Word Search: Fix Grid Layout
        if (finalHtml.includes('<title>Word Search</title>')) {
            console.log("  [Word Search] Injecting Flexbox Layout fixes...");
            const wsCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; gap: 0 !important; width: 100% !important; max-width: 550px !important; margin: 0 auto !important; height: auto !important; }
            .cell { width: 10% !important; height: 35px !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; border: 1px solid #ccc; font-size: 1.2rem !important; }
        `;
            finalHtml = finalHtml.replace('</style>', (await processLegacyCss(wsCss)) + '</style>');
        }

        // V. Wordle: Fix Grid Layout
        if (finalHtml.includes('<title>Wordle</title>')) {
            console.log("  [Wordle] Injecting Flexbox Layout fixes...");
            let wordleCss = `
            #board-container { display: flex !important; flex-direction: column !important; height: 420px !important; }
            .row { display: flex !important; width: 100% !important; flex: 1 !important; justify-content: center !important; grid-template-columns: none !important; margin-bottom: 5px !important; }
            .row:last-child { margin-bottom: 0 !important; }
            .tile { flex: 1 !important; margin-right: 5px !important; height: 100% !important; width: auto !important; }
            .tile:last-child { margin-right: 0 !important; }
            .key-row { display: flex !important; width: 100% !important; justify-content: center !important; }
            .key { flex: 1 !important; margin: 0 3px !important; }
            .key.big { flex: 1.5 !important; }
        `;
            wordleCss = await processLegacyCss(wordleCss);
            finalHtml = finalHtml.replace('</style>', wordleCss + '</style>');
        }

        // Minify HTML *before* applying final legacy patches to prevent re-processing from stripping them
        let finalMinifiedHtml = await minifyHtmlContent(finalHtml);

        // Final Legacy CSS Patch (Run AFTER minification to ensure it persists)
        // Manual Fallback for Flexbox (Chrome 12 requires display: -webkit-box)
        const flexRegexVal = /display:\s*flex(!important)?/gi;
        const flexMatches = finalMinifiedHtml.match(flexRegexVal) || [];
        if (flexMatches.length > 0) {
            console.log(`    [Legacy HTML] Found ${flexMatches.length} 'display:flex' instances. Injecting fallbacks...`);
            // Nuclear Option: Brute Force Replacement for reliability
            // Replace ALL occurrences with the fallback + original. 
            // Minified output is simple: display:flex -> display:-webkit-box;display:flex
            finalMinifiedHtml = finalMinifiedHtml.replace(flexRegexVal, 'display:-webkit-box;display:flex');
        }

        return finalMinifiedHtml;


    } catch (err) {
        console.error("Legacy Transpile Error", err);
        return htmlContent;
    }
}

async function run() {
    console.log("🚀 Starting Build...");

    // 1. Clean & Setup Directories
    await fs.emptyDir(BUILD_DIR);
    await fs.ensureDir(MAIN_DIR);
    await fs.ensureDir(LITE_DIR);
    await fs.ensureDir(LEGACY_DIR);

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

        // Copy to Legacy
        const destLegacy = path.join(LEGACY_DIR, item);
        await fs.copy(srcPath, destLegacy);
    }

    // 2.5 Process Main Files (Minify Only)
    console.log("🛠️  Minifying Main Version...");

    // Main HTML
    const mainHtmlFiles = glob.sync(`${MAIN_DIR}/**/*.html`);
    for (const file of mainHtmlFiles) {
        const html = await fs.readFile(file, 'utf8');
        await fs.outputFile(file, await minifyHtmlContent(html));
    }

    // Main CSS
    const mainCssFiles = glob.sync(`${MAIN_DIR}/**/*.css`);
    for (const file of mainCssFiles) {
        const css = await fs.readFile(file, 'utf8');
        await fs.outputFile(file, minifyCssString(css));
    }

    // Main JS (Safe Minify)
    const mainJsFiles = glob.sync(`${MAIN_DIR}/**/*.js`);
    for (const file of mainJsFiles) {
        // Skip already minified files (optional, but good practice)
        if (file.includes('.min.js')) continue;

        const code = await fs.readFile(file, 'utf8');
        const minified = await safeMinifyJs(code);
        await fs.outputFile(file, minified);
    }

    // 3. Process Lite HTML Files
    console.log("🛠️  Transpiling Lite Version...");
    const files = glob.sync(`${LITE_DIR}/**/*.html`);

    for (const file of files) {
        const html = await fs.readFile(file, 'utf8');
        const processed = await transpileHtml(html, path.basename(file));
        await fs.outputFile(file, processed);
    }

    // 4. Process Lite JS Files (External Scripts)
    console.log("🛠️  Transpiling JS Files...");
    const jsFiles = glob.sync(`${LITE_DIR}/**/*.js`);
    for (const file of jsFiles) {
        // Skip already minified files or libraries if we want (optional)
        // But to be safe, we transpile everything except obvious libraries if needed
        // For now, transpile all to ensure top-level await etc is handled.
        const code = await fs.readFile(file, 'utf8');
        const processed = await transpileJs(code);
        await fs.outputFile(file, processed);
    }

    // 5. Process Lite CSS Files (External Styles)
    console.log("🛠️  Processing CSS Files...");
    const cssFiles = glob.sync(`${LITE_DIR}/**/*.css`);
    for (const file of cssFiles) {
        const css = await fs.readFile(file, 'utf8');
        const processed = await processCss(css);
        await fs.outputFile(file, processed);
    }

    // 6. Process Legacy HTML Files
    console.log("🛠️  Transpiling Legacy Version...");
    const legHtmlFiles = glob.sync(`${LEGACY_DIR}/**/*.html`);
    for (const file of legHtmlFiles) {
        if (file.includes('google')) continue; // Skip google verification file if any?
        const html = await fs.readFile(file, 'utf8');
        const processed = await transpileLegacyHtml(html, path.basename(file));
        await fs.outputFile(file, processed);
    }

    // 7. Process Legacy JS (External)
    const legJsFiles = glob.sync(`${LEGACY_DIR}/**/*.js`);
    for (const file of legJsFiles) {
        const code = await fs.readFile(file, 'utf8');
        const processed = await transpileLegacyJs(code);
        await fs.outputFile(file, processed);
    }

    // 8. Process Legacy CSS
    const legCssFiles = glob.sync(`${LEGACY_DIR}/**/*.css`);
    for (const file of legCssFiles) {
        const css = await fs.readFile(file, 'utf8');
        const processed = await processLegacyCss(css);
        await fs.outputFile(file, processed);
    }

    // 5. Final Legacy Patch (Run post-build script to ensure robustness)
    try {
        require('./scripts/legacy-patch.js');
    } catch (err) {
        console.error("Failed to run scripts/legacy-patch.js", err);
    }

    console.log("✅ Build Complete!");
}

run().catch(console.error);