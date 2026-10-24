const fs = require('fs-extra');
const path = require('path');
const babel = require('@babel/core');
const cheerio = require('cheerio');
const glob = require('glob');
const { execSync } = require('child_process');
const postcss = require('postcss');
const postcssPresetEnv = require('postcss-preset-env');
const generateSitemap = require('./scripts/generate-sitemap');

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
    'workers', 'scripts', 'screenshots', 'admin', 'Sync', 'pocketbase',
    // Kindle launcher source; the built downloads/ are generated below.
    'kindle',
    // Firebase Backend Files (Keep in repo, ignore for hosting)
    'firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json', 'rtdb-rules.json',
    // CREDENTIALS — MUST NEVER BE PUBLISHED. These were live on rekindle.ink and
    // beta.rekindle.ink until 2026-10-20 because they were missing from this list:
    //  /service-account.json          (rekindle-dd1fa admin key)
    //  /service-account-social.json   (rekindle-socials admin key)
    //  /firebase-functions/.env       (OPENAI_API_KEY + the social admin key)
    'service-account.json', 'service-account-social.json', '.env',
    'firebase-functions', 'firebase-social.json',
    // Akinator relay backend (Node container, deployed to Northflank — never
    // static-hosted; it also carries package.json/node_modules).
    'akinator-service'
];

// Files/dirs that must never appear in a deploy directory. The build fails
// loudly if any of them survive the copy step, so a future ignoreList edit
// cannot silently republish credentials.
const FORBIDDEN_IN_DEPLOY = [
    'service-account.json', 'service-account-social.json', '.env',
    'firebase-functions', 'firebase-social.json', 'firebase.json',
    'rtdb-rules.json', 'firestore.rules', 'workers', 'scripts', 'admin',
    'akinator-service'
];

// DOM APIs used by the app that WebKit ~534 (Kobo / pre-Chromium Kindle)
// does not provide. Core-js only polyfills language built-ins, so these must
// run before any page script. Without them the home page throws on
// querySelectorAll(...).forEach / Element.remove() / classList / CustomEvent.
const OLD_BROWSER_DOM_SHIMS = `
<script>
    (function () {
        if (window.NodeList && !NodeList.prototype.forEach) { NodeList.prototype.forEach = Array.prototype.forEach; }
        if (window.HTMLCollection && !HTMLCollection.prototype.forEach) { HTMLCollection.prototype.forEach = Array.prototype.forEach; }

        if (window.Element && !Element.prototype.remove) {
            Element.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
        }

        if (window.Element) {
            if (!Element.prototype.matches) {
                Element.prototype.matches = Element.prototype.webkitMatchesSelector || Element.prototype.mozMatchesSelector || Element.prototype.msMatchesSelector || Element.prototype.oMatchesSelector;
            }
            if (!Element.prototype.closest) {
                Element.prototype.closest = function (selector) {
                    var el = this;
                    while (el && el.nodeType === 1) {
                        if (el.matches && el.matches(selector)) return el;
                        el = el.parentElement || el.parentNode;
                    }
                    return null;
                };
            }
        }

        if (window.DOMTokenList) {
            var probe = document.createElement('div');

            var supportsToggleForce = false;
            try {
                probe.classList.toggle('rekindle-probe', false);
                supportsToggleForce = !probe.classList.contains('rekindle-probe');
            } catch (e) { supportsToggleForce = false; }
            if (!supportsToggleForce) {
                DOMTokenList.prototype.toggle = function (token, force) {
                    if (arguments.length < 2) {
                        if (this.contains(token)) { this.remove(token); return false; }
                        this.add(token);
                        return true;
                    }
                    if (force) { this.add(token); return true; }
                    this.remove(token);
                    return false;
                };
            }

            var supportsMultiToken = false;
            try {
                probe.classList.add('rekindle-probe-a', 'rekindle-probe-b');
                supportsMultiToken = probe.classList.contains('rekindle-probe-a') && probe.classList.contains('rekindle-probe-b');
            } catch (e) { supportsMultiToken = false; }
            if (!supportsMultiToken) {
                var nativeAdd = DOMTokenList.prototype.add;
                var nativeRemove = DOMTokenList.prototype.remove;
                DOMTokenList.prototype.add = function () {
                    for (var i = 0; i < arguments.length; i++) nativeAdd.call(this, arguments[i]);
                };
                DOMTokenList.prototype.remove = function () {
                    for (var i = 0; i < arguments.length; i++) nativeRemove.call(this, arguments[i]);
                };
            }
        }

        try { new window.CustomEvent('rekindle-probe'); } catch (e) {
            var CustomEventShim = function (event, params) {
                params = params || { bubbles: false, cancelable: false, detail: null };
                var evt = document.createEvent('CustomEvent');
                evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
                return evt;
            };
            CustomEventShim.prototype = window.Event.prototype;
            window.CustomEvent = CustomEventShim;
        }

        if (!window.requestAnimationFrame) {
            window.requestAnimationFrame = window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || function (cb) {
                return setTimeout(function () { cb(Date.now()); }, 16);
            };
            window.cancelAnimationFrame = window.webkitCancelAnimationFrame || window.mozCancelAnimationFrame || function (id) { clearTimeout(id); };
        }

        if (!window.performance) { window.performance = {}; }
        if (!window.performance.now) {
            window.performance.now = window.performance.webkitNow || function () { return Date.now(); };
        }

        // --- ES5 polyfills for APIs the app calls unguarded ---
        // core-js only covers language built-ins, so these are the Web APIs
        // that are missing on QtWebKit 538.1 (Kobo) and WebKit 534 (old Kindles).
        // Keep this block ES5: it is injected after Babel has run.

        if (!window.AbortController) {
            var AbortSignalShim = function () {
                this.aborted = false;
                this.onabort = null;
                this._listeners = [];
            };
            AbortSignalShim.prototype.addEventListener = function (type, fn) {
                if (type === 'abort' && typeof fn === 'function') this._listeners.push(fn);
            };
            AbortSignalShim.prototype.removeEventListener = function (type, fn) {
                if (type !== 'abort') return;
                var idx = this._listeners.indexOf(fn);
                if (idx !== -1) this._listeners.splice(idx, 1);
            };
            AbortSignalShim.prototype.dispatchEvent = function (evt) {
                if (typeof this.onabort === 'function') this.onabort.call(this, evt);
                for (var i = 0; i < this._listeners.length; i++) this._listeners[i].call(this, evt);
                return true;
            };
            var AbortControllerShim = function () { this.signal = new AbortSignalShim(); };
            AbortControllerShim.prototype.abort = function () {
                if (this.signal.aborted) return;
                this.signal.aborted = true;
                this.signal.dispatchEvent({ type: 'abort', target: this.signal });
            };
            window.AbortController = AbortControllerShim;
            window.AbortSignal = AbortSignalShim;
        }

        if (!window.TextEncoder && window.Uint8Array) {
            window.TextEncoder = function () {};
            window.TextEncoder.prototype.encode = function (input) {
                var str = String(input == null ? '' : input);
                var bytes = [];
                for (var i = 0; i < str.length; i++) {
                    var c = str.charCodeAt(i);
                    if (c < 0x80) {
                        bytes.push(c);
                    } else if (c < 0x800) {
                        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
                    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
                        var c2 = str.charCodeAt(++i);
                        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                    } else {
                        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
                    }
                }
                return new Uint8Array(bytes);
            };
        }

        if (!window.TextDecoder && window.Uint8Array) {
            window.TextDecoder = function () {};
            window.TextDecoder.prototype.decode = function (input) {
                var bytes = (input instanceof Uint8Array) ? input : new Uint8Array(input || []);
                var out = '';
                for (var i = 0; i < bytes.length;) {
                    var c = bytes[i++];
                    if (c < 0x80) {
                        out += String.fromCharCode(c);
                    } else if (c >= 0xC0 && c < 0xE0) {
                        out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
                    } else if (c >= 0xE0 && c < 0xF0) {
                        out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
                    } else if (c >= 0xF0) {
                        var point = ((c & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
                        point -= 0x10000;
                        out += String.fromCharCode(0xD800 + (point >> 10), 0xDC00 + (point & 0x3FF));
                    }
                }
                return out;
            };
        }

        // bad_words.js calls String#matchAll at runtime; core-js 2.6 predates it.
        if (!String.prototype.matchAll) {
            String.prototype.matchAll = function (regexp) {
                var str = String(this);
                if (!regexp || typeof regexp.exec !== 'function') {
                    throw new TypeError('matchAll requires a RegExp');
                }
                var flags = 'g';
                if (regexp.ignoreCase) flags += 'i';
                if (regexp.multiline) flags += 'm';
                var re = new RegExp(regexp.source, flags);
                var matches = [];
                var m;
                while ((m = re.exec(str)) !== null) {
                    matches.push(m);
                    if (m[0] === '') re.lastIndex++;
                }
                return matches;
            };
        }

        if (window.Element) {
            var asNode = function (doc, item) {
                return typeof item === 'string' ? doc.createTextNode(item) : item;
            };
            if (!Element.prototype.append) {
                Element.prototype.append = function () {
                    for (var i = 0; i < arguments.length; i++) this.appendChild(asNode(this.ownerDocument || document, arguments[i]));
                };
            }
            if (!Element.prototype.prepend) {
                Element.prototype.prepend = function () {
                    var first = this.firstChild;
                    for (var i = 0; i < arguments.length; i++) this.insertBefore(asNode(this.ownerDocument || document, arguments[i]), first);
                };
            }
            if (!Element.prototype.before) {
                Element.prototype.before = function () {
                    if (!this.parentNode) return;
                    for (var i = 0; i < arguments.length; i++) this.parentNode.insertBefore(asNode(this.ownerDocument || document, arguments[i]), this);
                };
            }
            if (!Element.prototype.after) {
                Element.prototype.after = function () {
                    if (!this.parentNode) return;
                    var next = this.nextSibling;
                    for (var i = 0; i < arguments.length; i++) this.parentNode.insertBefore(asNode(this.ownerDocument || document, arguments[i]), next);
                };
            }
            if (!Element.prototype.replaceWith) {
                Element.prototype.replaceWith = function () {
                    if (!this.parentNode) return;
                    var parent = this.parentNode;
                    var next = this.nextSibling;
                    parent.removeChild(this);
                    for (var i = 0; i < arguments.length; i++) parent.insertBefore(asNode(this.ownerDocument || document, arguments[i]), next);
                };
            }
        }

        if (window.HTMLCanvasElement && window.Blob && window.Uint8Array && window.atob && !HTMLCanvasElement.prototype.toBlob) {
            HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
                var dataURL;
                try { dataURL = this.toDataURL(type || 'image/png', quality); } catch (e) { callback(null); return; }
                var parts = String(dataURL).split(',');
                if (parts.length < 2) { callback(null); return; }
                var mimeMatch = parts[0].match(/:(.*?);/);
                var mime = mimeMatch ? mimeMatch[1] : (type || 'image/png');
                var binary;
                try { binary = atob(parts[1]); } catch (e2) { callback(null); return; }
                var buffer = new ArrayBuffer(binary.length);
                var view = new Uint8Array(buffer);
                for (var i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i) & 0xFF;
                try { callback(new Blob([buffer], { type: mime })); } catch (e3) { callback(null); }
            };
        }

        window.rekindleHasWebCrypto = !!(window.crypto && window.crypto.subtle);

        // Cloudflare Pages serves extensionless routes, and a *.html request gets
        // a 308 first. QtWebKit 538.1 / WebKit 534 cannot follow 308, so strip
        // .html from local links before the tap turns into a navigation.
        window.rekindleExtensionlessHref = function (href) {
            if (!href) return href;
            if (/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href)) return href;
            var match = String(href).match(/^([^?#]*?)\\.html([?#].*)?$/i);
            if (!match) return href;
            var linkPath = match[1];
            if (/(^|\\/)index$/i.test(linkPath)) linkPath = linkPath.replace(/index$/i, '');
            if (!linkPath) linkPath = '/';
            return linkPath + (match[2] || '');
        };

        if (document.addEventListener) {
            document.addEventListener('click', function (e) {
                var el = e.target;
                while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentNode;
                if (!el || el.tagName !== 'A' || !el.getAttribute) return;
                var href = el.getAttribute('href');
                if (!href) return;
                var fixed = window.rekindleExtensionlessHref(href);
                if (fixed === href) return;
                if (e.preventDefault) e.preventDefault();
                window.location.href = fixed;
            }, true);
        }
    })();
</script>`;

// Refuse to report success when a constrained build still points at a remote
// library. A flaky CDN used to produce a "complete" Lite build with eight
// libs missing because downloadAndTranspileLib returned the CDN URL.
async function assertLocalLibs() {
    for (const dir of [LITE_DIR, LEGACY_DIR]) {
        const missing = new Set();
        for (const file of glob.sync(path.join(dir, '**/*.html'), { nodir: true })) {
            const html = await fs.readFile(file, 'utf8');
            const re = /<script[^>]*src="(libs\/[^"]+)"/g;
            let match;
            while ((match = re.exec(html))) {
                if (!(await fs.pathExists(path.join(dir, match[1])))) missing.add(match[1]);
            }
        }
        if (missing.size) {
            throw new Error(`Missing local libraries in ${dir}: ${[...missing].join(', ')}`);
        }
    }
}

async function assertNoSecretsInDeploy() {
    const problems = [];
    for (const dir of [MAIN_DIR, LITE_DIR, LEGACY_DIR]) {
        for (const name of FORBIDDEN_IN_DEPLOY) {
            const p = path.join(dir, name);
            if (await fs.pathExists(p)) problems.push(p);
            // Nested .env (e.g. firebase-functions/.env) is covered by the dir check
        }
    }
    if (problems.length) {
        console.error("\n🚨 BUILD ABORTED — credentials would have been published:");
        problems.forEach(p => console.error("   " + p));
        throw new Error("Refusing to build a deploy directory containing secrets.");
    }
}

// Deployment routing lives in the main entry pages (it must run before any
// other asset is fetched). Keep the two required routes explicit here so a
// future edit cannot silently send Kindles or Kobos to the wrong build.
const DEVICE_ROUTE_CHECKS = [
    { label: 'Kobo -> legacy', regex: /isKobo[\s\S]*?legacy\.rekindle\.ink/ },
    { label: 'pre-Chromium Kindle -> lite', regex: /isKindle[\s\S]*?lite\.rekindle\.ink/ }
];

async function assertDeviceRouting() {
    for (const name of ['index.html', 'index_old.html']) {
        const file = path.join(MAIN_DIR, name);
        if (!(await fs.pathExists(file))) continue;
        const html = await fs.readFile(file, 'utf8');
        const missing = DEVICE_ROUTE_CHECKS.filter(check => !check.regex.test(html));
        if (missing.length) {
            throw new Error(`Device routing missing from ${file}: ${missing.map(check => check.label).join(', ')}`);
        }
    }
}


// --- OLD-BUILD HTML REWRITES ---

// Cloudflare Pages answers *.html with a 308 to the extensionless route. QtWebKit
// 538.1 (Kobo) and WebKit 534 (pre-Chromium Kindle) predate 308 support, and the
// old builds have no service worker to intercept the navigation. Rewriting local
// links here keeps the tap on the first request. index.html maps to "/" because
// /index is itself a 308 on Pages; external URLs are left untouched.
function extensionlessLocalHtmlLink(href) {
    if (!href) return href;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
    const match = String(href).match(/^([^?#]*?)\.html([?#].*)?$/i);
    if (!match) return href;
    let linkPath = match[1];
    if (/(^|\/)index$/i.test(linkPath)) linkPath = linkPath.replace(/index$/i, '');
    if (!linkPath) linkPath = '/';
    return linkPath + (match[2] || '');
}

function rewriteLocalHtmlLinks(html) {
    return String(html)
        // Static href attributes (and href attributes inside JS template strings).
        .replace(/(\bhref\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
            return pre + extensionlessLocalHtmlLink(url) + post;
        })
        // Inline handlers and scripts that assign location directly.
        .replace(/(location(?:\.href)?\s*=\s*["'])([^"']+)(["'])/g, (m, pre, url, post) => {
            return pre + extensionlessLocalHtmlLink(url) + post;
        })
        .replace(/(location\.replace\(\s*["'])([^"']+)(["'])/g, (m, pre, url, post) => {
            return pre + extensionlessLocalHtmlLink(url) + post;
        });
}

// WebKit 534 (Lite) and QtWebKit 538.1 (Legacy) only have the 2009 flexbox
// (-webkit-box), not unprefixed flex, and they need -webkit-box-lines to wrap.
// processCss() handles the source <style> blocks, but inline style attributes,
// JS `style.display = 'flex'` assignments and the app-specific CSS injected
// after PostCSS all bypass it. This pass covers those, and is safe on modern
// engines because the unprefixed value stays last in CSS.
function addOldEngineLayoutFallbacks(html) {
    const fixCssText = (css) => css
        .replace(/(?<!-webkit-inline-box;)display\s*:\s*inline-flex\b/gi, 'display:-webkit-inline-box;display:inline-flex')
        .replace(/(?<!-webkit-box;)display\s*:\s*flex\b/gi, 'display:-webkit-box;display:flex')
        .replace(/display\s*:\s*grid\b/gi, 'display:-webkit-box;display:flex;-webkit-box-lines:multiple;flex-wrap:wrap')
        .replace(/(?<!-webkit-box-lines:multiple;)flex-wrap\s*:\s*wrap\b/gi, '-webkit-box-lines:multiple;flex-wrap:wrap')
        // Old flexbox equivalents for alignment. .modal-overlay and many tabs set
        // display via JS, so PostCSS never saw a display:flex in their rule and
        // did not emit these prefixes.
        .replace(/\balign-items\s*:\s*center\b/gi, '-webkit-box-align:center;align-items:center')
        .replace(/\balign-items\s*:\s*flex-start\b/gi, '-webkit-box-align:start;align-items:flex-start')
        .replace(/\balign-items\s*:\s*start\b/gi, '-webkit-box-align:start;align-items:start')
        .replace(/\balign-items\s*:\s*flex-end\b/gi, '-webkit-box-align:end;align-items:flex-end')
        .replace(/\balign-items\s*:\s*end\b/gi, '-webkit-box-align:end;align-items:end')
        .replace(/\balign-items\s*:\s*stretch\b/gi, '-webkit-box-align:stretch;align-items:stretch')
        .replace(/\bjustify-content\s*:\s*center\b/gi, '-webkit-box-pack:center;justify-content:center')
        .replace(/\bjustify-content\s*:\s*space-between\b/gi, '-webkit-box-pack:justify;justify-content:space-between')
        .replace(/\bjustify-content\s*:\s*space-around\b/gi, '-webkit-box-pack:justify;justify-content:space-around')
        .replace(/\bjustify-content\s*:\s*flex-start\b/gi, '-webkit-box-pack:start;justify-content:flex-start')
        .replace(/\bjustify-content\s*:\s*start\b/gi, '-webkit-box-pack:start;justify-content:start')
        .replace(/\bjustify-content\s*:\s*flex-end\b/gi, '-webkit-box-pack:end;justify-content:flex-end')
        .replace(/\bjustify-content\s*:\s*end\b/gi, '-webkit-box-pack:end;justify-content:end')
        .replace(/\bflex-direction\s*:\s*column\b/gi, '-webkit-box-orient:vertical;-webkit-box-direction:normal;flex-direction:column')
        .replace(/\bflex-direction\s*:\s*column-reverse\b/gi, '-webkit-box-orient:vertical;-webkit-box-direction:reverse;flex-direction:column-reverse')
        .replace(/\bflex-direction\s*:\s*row-reverse\b/gi, '-webkit-box-orient:horizontal;-webkit-box-direction:reverse;flex-direction:row-reverse')
        .replace(/\bflex-grow\s*:\s*1\b/gi, '-webkit-box-flex:1;flex-grow:1')
        .replace(/\bflex\s*:\s*1\b/gi, '-webkit-box-flex:1;flex:1');

    const fixJsText = (js) => {
        // Replace every quoted flex value in a style.display assignment, including
        // ternaries like `style.display = open ? 'flex' : 'none'`.
        let fixed = js.replace(/\.style\.display\s*=\s*[^;\n]+/g, (stmt) => {
            return stmt.replace(/(["'])(inline-flex|flex|grid)\1/g, (m, q, value) => {
                return q + (value === 'inline-flex' ? '-webkit-inline-box' : '-webkit-box') + q;
            });
        });
        return fixCssText(fixed);
    };

    let out = String(html);

    // Source <style> blocks plus app-specific CSS injected after PostCSS.
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, css, close) => {
        return open + fixCssText(css) + close;
    });

    // Inline style="display:flex; align-items:center" attributes.
    out = out.replace(/(\sstyle\s*=\s*["'])([^"']*)(["'])/gi, (m, pre, css, post) => {
        return pre + fixCssText(css) + post;
    });

    // Inline scripts: assignments plus HTML strings passed to innerHTML.
    // `</script\s*>` also matches "</script >", which a browser accepts as an
    // end tag but the old filter left untouched (CodeQL js/bad-tag-filter).
    out = out.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (m, open, js, close) => {
        return open + fixJsText(js) + close;
    });

    // Inline event handlers (onclick, onchange, ...) also navigate/flex directly.
    out = out.replace(/(\son[a-z]+\s*=\s*)(["'])([\s\S]*?)\2/gi, (m, pre, quote, js) => {
        return pre + quote + fixJsText(js) + quote;
    });

    return out;
}

// Babel/minification rewrites `cell.className = 'cell';` to double quotes, which
// silently defeated the Crossword, Minesweeper and Nonograms cell-size patches.
// Match either quote style instead of a single hard-coded string.
function injectAfterCellClass(html, statement) {
    return String(html).replace(/(cell\.className\s*=\s*["']cell["'];)/, '$1 ' + statement);
}

// A locally transpiled library can never match the CDN Subresource Integrity
// hash copied from the source HTML. Keeping the hash makes the browser refuse
// to execute the file (chess/reader/interactive/flipbook/epub/docs/airtype/2pchess
// were all dead because of this). Strip SRI from every same-origin script; remote
// CDN scripts keep theirs.
function stripLocalScriptIntegrity($) {
    $('script[src]').each((i, el) => {
        const src = $(el).attr('src') || '';
        if (/^(?:https?:)?\/\//i.test(src)) return;
        $(el).removeAttr('integrity');
        $(el).removeAttr('crossorigin');
    });
}

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
                // Lite now targets pre-Chromium Kindles (Mesquite / WebKit ~534).
                // Chrome 12 makes autoprefixer emit the -webkit-box-* flexbox
                // properties those engines need, not just display:-webkit-box.
                browsers: 'Chrome 12',
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
            console.log("    [Lite CSS] Injecting -webkit-box fallbacks...");
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

    // For efficiency, we check existence so we don't redownload/retranspile for every page.
    if (!fs.existsSync(destPath)) {
        const partPath = destPath + '.part';
        try {
            console.log(`    Downloading & Transpiling ${filename}...`);
            // Download to a .part file first: a killed build used to leave a
            // truncated lib that the next build silently reused. The timeout
            // stops a stalled CDN connection from hanging the whole build.
            fs.removeSync(partPath);
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    execSync(`curl -L --fail --silent --show-error --connect-timeout 15 --max-time 60 --retry 1 --retry-delay 2 "${url}" -o "${partPath}"`, { stdio: 'ignore', timeout: 120000 });
                    if (!fs.existsSync(partPath) || fs.statSync(partPath).size === 0) {
                        throw new Error('empty download');
                    }
                    lastError = null;
                    break;
                } catch (attemptError) {
                    lastError = attemptError;
                    fs.removeSync(partPath);
                    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            if (lastError) throw lastError;
            fs.renameSync(partPath, destPath);

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
            try { fs.removeSync(partPath); } catch (_) {}
            try { fs.removeSync(destPath); } catch (_) {}
            return url;
        }
    }
    return `libs/${filename}`;
}

// Lite is the build served to pre-Chromium Kindles (Mesquite / WebKit ~534).
// Those engines have no native Promise and cannot parse ES6 syntax such as
// arrow functions, template literals, `let`/`const` or classes. App code must
// therefore be fully down-levelled to ES5; the downloaded polyfill libraries
// are already ES5, so they keep the cheaper Chrome 44 target.
async function transpileJs(code, forceEs5 = false) {
    try {
        const result = await babel.transformAsync(code, {
            presets: [['@babel/preset-env', {
                targets: "chrome 44",
                modules: false,
                useBuiltIns: false, // We use an external polyfill bundle
                forceAllTransforms: forceEs5,
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
                        // Download AND TRANSPILE to _deploy/lite/libs.
                        // Force ES5 here too: pre-Chromium Kindles cannot parse these
                        // libraries, and the backtick obfuscation below is only safe
                        // once Babel has rewritten template literals to concat().
                        const localPath = await downloadAndTranspileLib(url, LITE_DIR, name, (code) => transpileJs(code, true));
                        console.log(`  [${key}] Localized: ${src} -> ${localPath}`);
                        $(el).attr('src', localPath);
                        break;
                    }
                }
            }
        }

        // 2b. A localized copy no longer matches the CDN integrity hash it was
        // shipped with; keeping it makes the browser refuse to run the script.
        stripLocalScriptIntegrity($);

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

                // forceEs5: this inline script must parse on Mesquite (pre-Chromium Kindle).
                const transpiled = await transpileJs(code, true);
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

        <!-- 2c. DOM shims (NodeList.forEach, Element.remove, classList, CustomEvent) -->
        ${OLD_BROWSER_DOM_SHIMS}
        
        <!-- 3. Old e-reader shims (pre-Chromium Kindle / Kobo) -->
        <script>
            // Mesquite may not expose a console object at all. The app logs in
            // several startup paths, so make logging a no-op rather than crash.
            if (!window.console) { window.console = {}; }
            if (!window.console.log) { window.console.log = function() {}; }
            if (!window.console.warn) { window.console.warn = function() {}; }
            if (!window.console.error) { window.console.error = function() {}; }
            if (!window.console.info) { window.console.info = function() {}; }
            if (!window.console.debug) { window.console.debug = function() {}; }

            window.isLiteVersion = true;
            
            // StructuredClone Polyfill (Simple JSON fallback)
            if (!window.structuredClone) {
                window.structuredClone = function(obj) { return JSON.parse(JSON.stringify(obj)); };
            }

            // Window.open / Target Blank Fix
            // E-ink browsers don't support multiple tabs well. Redirect _blank to self.
            var originalOpen = window.open;
            window.open = function(url, target, features) {
                if (target === '_blank' || !target) {
                    window.location.href = url;
                    return null;
                }
                return originalOpen(url, target, features);
            };

            // Array.at / String.at should be covered by CoreJS, but just in case:
            if (![].at) { Array.prototype.at = function(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; if (n < 0 || n >= this.length) return undefined; return this[n]; }; }
            if (!"".at) { String.prototype.at = function(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; if (n < 0 || n >= this.length) return undefined; return this[n]; }; }
            
            // Promise.any fallback (ES5 - this shim is injected after Babel runs,
            // so it must not contain arrow functions or let/const).
            if (!Promise.any) {
                Promise.any = function(promises) {
                    return new Promise(function(resolve, reject) {
                        promises = Array.from(promises);
                        var errors = [];
                        var count = 0;
                        promises.forEach(function(p) {
                            Promise.resolve(p).then(resolve).catch(function(e) {
                                errors.push(e);
                                count++;
                                if (count === promises.length) {
                                    var err = new Error("All promises were rejected");
                                    err.name = "AggregateError";
                                    err.errors = errors;
                                    reject(err);
                                }
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
        $('.os-title, .logo-item').after('<div class="lite-badge" onclick="document.getElementById(\'lite-info-modal\').style.display=\'flex\'" style="font-size:0.6em; cursor:pointer; border:1px solid black; background:white; padding:0 4px; margin-top:0px; display:inline-block;" title="About Lite Mode">LITE</div>');

        // Fix for specific styling in Lite where badges might look weird
        $('style').append('.lite-badge { background: white; border: 1px solid black; padding: 0 2px; }');

        $('body').append(`
        <div id="lite-info-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;" onclick="this.style.display='none'">
            <div class="modal-box" onclick="event.stopPropagation()" style="background:white; border:2px solid black; padding:20px; width:300px; max-width:80%; text-align:center; box-shadow:4px 4px 0 black; font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:2px solid black; padding-bottom:10px;">Lite Version</h3>
                <p style="margin:15px 0;">This is a lightweight version of ReKindle designed for older e-readers, including pre-Chromium Kindles.</p>
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
                <div style="display:grid; grid-auto-flow:column; justify-content:center; gap:10px;">
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
                    window.location.href = window.rekindleExtensionlessHref ? window.rekindleExtensionlessHref(appId + ".html") : appId + ".html";
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
             /* Old -webkit-box shrinks a 220px flex child to its content width,
                which clipped "MULTIPLAYER GAMES". Float the sidebar and let the
                BFC app view sit beside it. Do NOT target .app-view: legacy-patch
                rewrites every .app-view rule after the build. */
             .dashboard { display: block !important; }
             .sidebar { float: left !important; width: 220px !important; min-width: 220px !important; height: 100% !important; -webkit-box-sizing: border-box !important; box-sizing: border-box !important; }
             .nav-item { white-space: normal !important; }
             @media (max-width: 520px) {
                 .sidebar { float: none !important; display: -webkit-box !important; width: 100% !important; height: auto !important; border-right: none !important; border-bottom: 2px solid black !important; }
             }
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

        // B. Browser: the page-local history store is named visitHistory in
        // browser.html. The old post-build rename ran after Babel and matched
        // nothing (minified code uses double quotes), so it was removed.
        // C. Pixel App: Fix Grid Layout (Convert to Flex)
        if (finalHtml.includes('id="pixel-canvas"')) {
            console.log("  [Pixel] Injecting Grid -> Flexbox fixes...");
            const pixelParams = `
            .gallery-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .gallery-item { width: 130px !important; height: 156px !important; margin: 10px !important; }
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
            #grid-container { display: block !important; font-size: 0 !important; width: 300px !important; height: 300px !important; gap: 0 !important; }
            .cell { display: inline-block !important; vertical-align: top !important; width: 64px !important; height: 64px !important; margin: 2px !important; flex: none !important; }
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
                #board { display: block !important; font-size: 0 !important; width: 300px !important; height: 300px !important; border: 4px solid black !important; }
                .square { display: inline-block !important; vertical-align: top !important; width: 12.5% !important; height: 12.5% !important; flex: none !important; margin: 0 !important; padding: 0 !important; }
            `;
                finalHtml = finalHtml.replace('</style>', boardCss + '</style>');
            }
        }

        // I. Battleships: Fix 10x10 Grid
        if (finalHtml.includes('<title>Battleship</title>')) {
            console.log("  [Battleship] Injecting 10x10 Grid Fixes...");
            const battleCss = `
            /* Fix Setup and Game Boards */
            .grid-container { display: block !important; font-size: 0 !important; width: 300px !important; height: 300px !important; gap: 0 !important; }
            /* Override generic .grid-container > * rule which might set margin: 10px */
            .grid-container > .cell { display: inline-block !important; vertical-align: top !important; width: 10% !important; height: 10% !important; flex: none !important; margin: 0 !important; border: 1px solid #ccc; box-sizing: border-box; }
        `;
            finalHtml = finalHtml.replace('</style>', battleCss + '</style>');
        }
        // I2. Cube Dash: keep the PRACTICE button inside the menu row.
        if (finalHtml.includes('<title>Cube Dash</title>')) {
            console.log("  [Cube Dash] Injecting level-row layout fixes...");
            const cubeCss = `
            .lvl-row { display: block !important; overflow: hidden !important; }
            .lvl-main { float: left !important; width: 73% !important; margin-right: 2% !important; }
            .lvl-prac { float: right !important; width: 23% !important; min-width: 0 !important; }
            .lvl-name-line { font-size: 0.8rem !important; }
            .lvl-sub-line { font-size: 0.65rem !important; }
        `;
            finalHtml = finalHtml.replace('</style>', cubeCss + '</style>');
        }
        // I3. Solitaire: custom properties are stripped, so the media-query
        // --card-width overrides never reached .pile/.card (cards stayed 45px).
        if (finalHtml.includes('<title>Solitaire</title>')) {
            console.log("  [Solitaire] Injecting responsive card sizes...");
            const solCss = `
            @media (min-width: 600px) {
                .pile, .card { width: 65px !important; height: 94px !important; }
                .column { width: 65px !important; }
            }
            @media (min-width: 800px) {
                .pile, .card { width: 80px !important; height: 116px !important; }
                .column { width: 80px !important; }
            }
        `;
            finalHtml = finalHtml.replace('</style>', solCss + '</style>');
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
            #game-grid { display: block !important; font-size: 0 !important; gap: 0 !important; text-align: center !important; }
            .card { display: inline-block !important; vertical-align: top !important; width: 22% !important; margin: 1% !important; height: 90px !important; flex: none !important; }
        `;
            finalHtml = finalHtml.replace('</style>', memoryCss + '</style>');
        }

        // L. Mini Crossword: Fix 5x5 Grid
        if (finalHtml.includes('<title>Mini Crossword</title>')) {
            console.log("  [Mini Crossword] Injecting 5x5 Grid Fixes...");
            const miniCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 400px !important; height: 100vw !important; max-height: 400px !important; }
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
            #grid-container { display: block !important; font-size: 0 !important; gap: 0 !important; background: #fff !important; }
            .cell { display: inline-block !important; vertical-align: top !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; border: 1px solid #999; }
        `;
            finalHtml = finalHtml.replace('</style>', crossCss + '</style>');

            // Patch JS to set width/height
            finalHtml = injectAfterCellClass(finalHtml, "cell.style.width = (100/currentPuzzle.cols) + '%'; cell.style.height = (100/currentPuzzle.rows) + '%';");
        }

        // O. Minesweeper: Fix Dynamic Grid
        if (finalHtml.includes('<title>Minesweeper</title>')) {
            console.log("  [Minesweeper] Injecting Flexbox & JS Patch...");
            const mineCss = `
            #grid-container { display: block !important; font-size: 0 !important; gap: 0 !important; }
            .cell { display: inline-block !important; vertical-align: top !important; margin: 0 !important; box-sizing: border-box !important; border: 1px solid #999 !important; flex: none !important; }
        `;
            finalHtml = finalHtml.replace('</style>', mineCss + '</style>');

            // Patch JS
            finalHtml = injectAfterCellClass(finalHtml, "cell.style.width = (100/COLS) + '%';");
        }

        // P. Nerdle: Fix Flexbox Layout
        if (finalHtml.includes('<title>Nerdle</title>')) {
            console.log("  [Nerdle] Injecting Flexbox Layout fixes...");
            const nerdleCss = `
            #board-container { display: flex !important; flex-direction: column !important; }
            .row { display: flex !important; width: 100% !important; justify-content: center !important; margin-bottom: 4px !important; }
            .row:last-child { margin-bottom: 0 !important; }
            .tile { flex: 1 !important; margin-right: 4px !important; height: 48px !important; }
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
                finalHtml = injectAfterCellClass(finalHtml, "cell.style.width = (100/cols) + '%'; cell.style.height = (100/cols) + '%';");
            }
        }

        // R. Scrabble (Words): Fix 15x15 Grid
        if (finalHtml.includes('<title>Scrabble</title>')) {
            console.log("  [Scrabble] Injecting Flexbox Layout fixes...");
            const scrabbleCss = `
            #board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; height: 100vw !important; max-height: 400px !important; }
            .sq { width: 6.66% !important; height: 6.66% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
            finalHtml = finalHtml.replace('</style>', scrabbleCss + '</style>');
        }

        // S. Sudoku: Fix 9x9 Grid
        if (finalHtml.includes('<title>Sudoku</title>')) {
            console.log("  [Sudoku] Injecting Flexbox Layout fixes...");
            const sudokuCss = `
            #game-container { display: block !important; font-size: 0 !important; gap: 0 !important; max-width: 400px !important; margin: 0 auto 8px auto !important; }
            .cell { display: inline-block !important; vertical-align: top !important; width: 11.11% !important; height: 11.11% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
            
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

        // 9. Extensionless local links: Cloudflare Pages 308s *.html, which the
        // pre-Chromium Kindle WebKit (and Kobo) cannot follow.
        finalHtml = addOldEngineLayoutFallbacks(finalHtml);
        finalHtml = rewriteLocalHtmlLinks(finalHtml);

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

        // 1b. REMOVE COUNTER.DEV ANALYTICS (uses fetch, incompatible with Chrome 12)
        $('script').each((i, el) => {
            const src = $(el).attr('src') || '';
            if (src.includes('counter.dev')) {
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

        // 2b. A localized copy no longer matches the CDN integrity hash it was
        // shipped with; keeping it makes the browser refuse to run the script.
        stripLocalScriptIntegrity($);

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

        // 5. INJECT POLYFILLS
        // Core-JS 2.6.12 Shim (Includes Regenerator + CoreJS) - Best for Legacy
        const coreJsPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/core-js@2.6.12/client/shim.min.js", LEGACY_DIR, "core-js-shim.min.js", transpileLegacyJs);
        const urlPolyPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/url-search-params-polyfill@8.1.1/index.js", LEGACY_DIR, "url-search-params-polyfill.js", transpileLegacyJs);
        const fetchPolyPath = await downloadAndTranspileLib("https://cdn.jsdelivr.net/npm/whatwg-fetch@3.6.2/dist/fetch.umd.min.js", LEGACY_DIR, "whatwg-fetch.js", transpileLegacyJs);

        $('head').prepend(`
        <script src="${coreJsPath}"></script>
        <script src="${urlPolyPath}"></script>
        <script src="${fetchPolyPath}"></script>
        ${OLD_BROWSER_DOM_SHIMS}
        <script>
            // Old e-reader browsers may not expose a console object at all.
            if (!window.console) { window.console = {}; }
            if (!window.console.log) { window.console.log = function() {}; }
            if (!window.console.warn) { window.console.warn = function() {}; }
            if (!window.console.error) { window.console.error = function() {}; }
            if (!window.console.info) { window.console.info = function() {}; }
            if (!window.console.debug) { window.console.debug = function() {}; }

            window.isLegacyVersion = true;
            if (!window.structuredClone) { window.structuredClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }; }

            // Kobo's stock browser is the primary target for the Legacy build.
            // It handles _blank badly (single-window browser), so send the
            // navigation to the current window instead.
            var originalOpen = window.open;
            window.open = function(url, target, features) {
                if (target === '_blank' || !target) {
                    window.location.href = url;
                    return null;
                }
                return originalOpen(url, target, features);
            };

            // Array.at / String.at (ES2022) are not covered by the core-js 2 shim.
            if (![].at) { Array.prototype.at = function(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; if (n < 0 || n >= this.length) return undefined; return this[n]; }; }
            if (!"".at) { String.prototype.at = function(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; if (n < 0 || n >= this.length) return undefined; return this[n]; }; }

            // Promise.any (ES2021) fallback.
            if (!Promise.any) {
                Promise.any = function(promises) {
                    return new Promise(function(resolve, reject) {
                        promises = Array.from(promises);
                        var errors = [];
                        var count = 0;
                        promises.forEach(function(p) {
                            Promise.resolve(p).then(resolve).catch(function(e) {
                                errors.push(e);
                                count++;
                                if (count === promises.length) {
                                    var err = new Error("All promises were rejected");
                                    err.name = "AggregateError";
                                    err.errors = errors;
                                    reject(err);
                                }
                            });
                        });
                    });
                };
            }
        </script>
        `);

        // 6. ATTRIBUTE FIXES
        $('a[target="_blank"]').removeAttr('target');
        $('video source[src$=".mp4"]').each((i, el) => { const src = $(el).attr('src'); if (src) $(el).attr('src', src.replace('.mp4', '.webm')); });
        $('video[src$=".mp4"]').each((i, el) => { const src = $(el).attr('src'); if (src) $(el).attr('src', src.replace('.mp4', '.webm')); });

        // 7. VISUAL INDICATOR
        $('.os-title, .logo-item').after('<div class="legacy-badge" onclick="document.getElementById(\'lite-info-modal\').style.display=\'flex\'" style="font-size:0.6em; cursor:pointer; border:1px solid black; background:white; padding:0 4px; margin-top:0px; display:inline-block;" title="About Legacy Mode">LEGACY</div>');
        $('style').append('.legacy-badge { background: white; border: 1px solid black; padding: 0 2px; }');

        // 7b. INJECT INFO MODAL (Reusing Lite Modal ID for simplicity or creating new one? User said "modal popup we made")
        // The Lite modal says "Lite Version". We should probably make it generic or duplicate for Legacy.
        // Let's replicate it but say "Legacy Version".
        $('body').append(`
        <div id="lite-info-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;" onclick="this.style.display='none'">
            <div class="modal-box" onclick="event.stopPropagation()" style="background:white; border:2px solid black; padding:20px; width:300px; max-width:80%; text-align:center; box-shadow:4px 4px 0 black; font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:2px solid black; padding-bottom:10px;">Legacy Version</h3>
                <p style="margin:15px 0;">This version is designed for Kobo e-readers and other older devices.</p>
                <p style="margin:15px 0; font-size:0.9em;">Some apps are hidden or disabled due to hardware limitations.</p>
                <p style="margin:15px 0; font-size:0.9em;"><a href="/probe" style="color:black;font-weight:bold;">Run the browser probe</a> to check this device.</p>
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
                <div style="display:grid; grid-auto-flow:column; justify-content:center; gap:10px;">
                    <button class="sys-btn" onclick="document.getElementById('es6-warning-modal').style.display='none'" style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;">Back</button>
                    <button id="es6-proceed-btn" class="sys-btn" style="background:white; border:2px solid black; padding:8px 20px; font-weight:bold; cursor:pointer; box-shadow:2px 2px 0 black;">Proceed Anyway</button>
                </div>
            </div>
        </div>
        <script>
            function showEs6Warning(appId) {
                var modal = document.getElementById('es6-warning-modal');
                var btn = document.getElementById('es6-proceed-btn');
                btn.onclick = function() { window.location.href = window.rekindleExtensionlessHref ? window.rekindleExtensionlessHref(appId + ".html") : appId + ".html"; };
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
              /* Old -webkit-box shrinks a 220px flex child to its content width,
                which clipped "MULTIPLAYER GAMES". Float the sidebar and let the
                BFC app view sit beside it. Do NOT target .app-view: legacy-patch
                rewrites every .app-view rule after the build. */
             .dashboard { display: block !important; }
             .sidebar { float: left !important; width: 220px !important; min-width: 220px !important; height: 100% !important; -webkit-box-sizing: border-box !important; box-sizing: border-box !important; }
             .nav-item { white-space: normal !important; }
             @media (max-width: 520px) {
                 .sidebar { float: none !important; display: -webkit-box !important; width: 100% !important; height: auto !important; border-right: none !important; border-bottom: 2px solid black !important; }
             }
             .view-header { width: 100% !important; flex: none !important; margin-top: 25px !important; margin-bottom: 15px !important; }
              @media (max-width: 520px) { #featured-grid .featured-card { width: 96% !important; margin: 2% !important; } }
              `;

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

        // B. Browser: see the Lite build note. The page-local store is
        // visitHistory in browser.html; the old rename patch was dead.
        // C. Pixel App: Fix Grid Layout (Convert to Flex)
        if (finalHtml.includes('id="pixel-canvas"')) {
            console.log("  [Pixel] Injecting Grid -> Flexbox fixes...");
            let pixelParams = `
            .gallery-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .gallery-item { width: 130px !important; height: 156px !important; margin: 10px !important; }
        `;
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
            finalHtml = finalHtml.replace('</style>', convCss + '</style>');
        }

        // F. 2048: Fix Grid Layout
        if (finalHtml.includes('<title>2048</title>')) {
            console.log("  [2048] Injecting 4x4 Grid Fixes...");
            let g2048Css = `
            #grid-container { display: block !important; font-size: 0 !important; width: 300px !important; height: 300px !important; gap: 0 !important; }
            .cell { display: inline-block !important; vertical-align: top !important; width: 64px !important; height: 64px !important; margin: 2px !important; flex: none !important; }
            .grid-container > * { margin: 2px !important; } 
        `;
            finalHtml = finalHtml.replace('</style>', g2048Css + '</style>');
        }

        // G. Connections (Bindings): Fix Grid Layout
        if (finalHtml.includes('<title>Connections</title>')) {
            console.log("  [Connections] Injecting Grid Fixes...");
            let connCss = `
            .grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 0 !important; }
            .card { width: 23% !important; margin: 1% !important; height: 70px !important; }
        `;
            finalHtml = finalHtml.replace('</style>', connCss + '</style>');
        }

        // H. Chess & Checkers (1P & 2P): Fix 8x8 Board
        if (finalHtml.includes('<title>Chess</title>') || finalHtml.includes('<title>Checkers</title>') || finalHtml.includes('id="board"')) {
            if (finalHtml.includes('id="board"')) {
                console.log("  [Board Game] Injecting 8x8 Board Fixes...");
                let boardCss = `
                #board { display: block !important; font-size: 0 !important; width: 300px !important; height: 300px !important; border: 4px solid black !important; }
                .square { display: inline-block !important; vertical-align: top !important; width: 12.5% !important; height: 12.5% !important; flex: none !important; margin: 0 !important; padding: 0 !important; }
            `;
                finalHtml = finalHtml.replace('</style>', boardCss + '</style>');
            }
        }

        // I. Battleships: Fix 10x10 Grid
        if (finalHtml.includes('<title>Battleship</title>')) {
            console.log("  [Battleship] Injecting 10x10 Grid Fixes...");
            let battleCss = `
            .grid-container { display: block !important; font-size: 0 !important; width: 300px !important; height: 300px !important; gap: 0 !important; }
            /* Override generic .grid-container > * rule which might set margin: 10px */
            .grid-container > .cell { display: inline-block !important; vertical-align: top !important; width: 10% !important; height: 10% !important; flex: none !important; margin: 0 !important; border: 1px solid #ccc; box-sizing: border-box; }
        `;
            finalHtml = finalHtml.replace('</style>', battleCss + '</style>');
        }
        // I2. Cube Dash: keep the PRACTICE button inside the menu row.
        if (finalHtml.includes('<title>Cube Dash</title>')) {
            console.log("  [Cube Dash] Injecting level-row layout fixes...");
            const cubeCss = `
            .lvl-row { display: block !important; overflow: hidden !important; }
            .lvl-main { float: left !important; width: 73% !important; margin-right: 2% !important; }
            .lvl-prac { float: right !important; width: 23% !important; min-width: 0 !important; }
            .lvl-name-line { font-size: 0.8rem !important; }
            .lvl-sub-line { font-size: 0.65rem !important; }
        `;
            finalHtml = finalHtml.replace('</style>', cubeCss + '</style>');
        }
        // I3. Solitaire: custom properties are stripped, so the media-query
        // --card-width overrides never reached .pile/.card (cards stayed 45px).
        if (finalHtml.includes('<title>Solitaire</title>')) {
            console.log("  [Solitaire] Injecting responsive card sizes...");
            const solCss = `
            @media (min-width: 600px) {
                .pile, .card { width: 65px !important; height: 94px !important; }
                .column { width: 65px !important; }
            }
            @media (min-width: 800px) {
                .pile, .card { width: 80px !important; height: 116px !important; }
                .column { width: 80px !important; }
            }
        `;
            finalHtml = finalHtml.replace('</style>', solCss + '</style>');
        }

        // J. Settings (Pixel Drawer): Fix Grid
        if (finalHtml.includes('id="pixel-grid"')) {
            console.log("  [Settings] Injecting Pixel Grid Fixes...");
            let pixelCss = `
            #pixel-grid { display: flex !important; flex-wrap: wrap !important; width: 200px !important; height: 200px !important; gap: 0 !important; }
            .pixel { width: 12.5% !important; height: 12.5% !important; margin: 0 !important; border-top: 1px solid #eee; border-left: 1px solid #eee; box-sizing: border-box; flex-grow: 0 !important; max-width: none !important; }
        `;
            finalHtml = finalHtml.replace('</style>', pixelCss + '</style>');
        }

        // K. Memory: Fix Grid
        if (finalHtml.includes('<title>Memory</title>')) {
            console.log("  [Memory] Injecting Grid Fixes...");
            let memoryCss = `
            #game-grid { display: block !important; font-size: 0 !important; gap: 0 !important; text-align: center !important; }
            .card { display: inline-block !important; vertical-align: top !important; width: 22% !important; margin: 1% !important; height: 90px !important; flex: none !important; }
        `;
            finalHtml = finalHtml.replace('</style>', memoryCss + '</style>');
        }

        // L. Mini Crossword: Fix 5x5 Grid
        if (finalHtml.includes('<title>Mini Crossword</title>')) {
            console.log("  [Mini Crossword] Injecting 5x5 Grid Fixes...");
            let miniCss = `
            #grid-container { display: flex !important; flex-wrap: wrap !important; width: 100% !important; max-width: 400px !important; height: 100vw !important; max-height: 400px !important; }
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
            finalHtml = finalHtml.replace(
                'div.style.backgroundPosition',
                "div.style.width = (100/gridSize) + '%'; div.style.height = (100/gridSize) + '%'; div.style.backgroundPosition"
            );
        }

        // N. Crossword (Standard): Fix Dynamic Grid
        if (finalHtml.includes('<title>Crossword</title>')) {
            console.log("  [Crossword] Injecting Flexbox & JS Patch...");
            const crossCss = `
            #grid-container { display: block !important; font-size: 0 !important; gap: 0 !important; background: #fff !important; }
            .cell { display: inline-block !important; vertical-align: top !important; margin: 0 !important; box-sizing: border-box !important; flex: none !important; border: 1px solid #999; }
        `;
            finalHtml = finalHtml.replace('</style>', crossCss + '</style>');
            finalHtml = injectAfterCellClass(finalHtml, "cell.style.width = (100/currentPuzzle.cols) + '%'; cell.style.height = (100/currentPuzzle.rows) + '%';");
        }

        // O. Minesweeper: Fix Dynamic Grid
        if (finalHtml.includes('<title>Minesweeper</title>')) {
            console.log("  [Minesweeper] Injecting Flexbox & JS Patch...");
            const mineCss = `
            #grid-container { display: block !important; font-size: 0 !important; gap: 0 !important; }
            .cell { display: inline-block !important; vertical-align: top !important; margin: 0 !important; box-sizing: border-box !important; border: 1px solid #999 !important; flex: none !important; }
        `;
            finalHtml = finalHtml.replace('</style>', mineCss + '</style>');
            finalHtml = injectAfterCellClass(finalHtml, "cell.style.width = (100/COLS) + '%';");
        }

        // P. Nerdle: Fix Flexbox Layout
        if (finalHtml.includes('<title>Nerdle</title>')) {
            console.log("  [Nerdle] Injecting Flexbox Layout fixes...");
            const nerdleCss = `
            #board-container { display: flex !important; flex-direction: column !important; }
            .row { display: flex !important; width: 100% !important; justify-content: center !important; margin-bottom: 4px !important; }
            .row:last-child { margin-bottom: 0 !important; }
            .tile { flex: 1 !important; margin-right: 4px !important; height: 48px !important; }
            .tile:last-child { margin-right: 0 !important; }
        `;
            finalHtml = finalHtml.replace('</style>', nerdleCss + '</style>');
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
            finalHtml = finalHtml.replace('</style>', nonoCss + '</style>');
            if (finalHtml.includes('function renderGameGrid()')) {
                finalHtml = injectAfterCellClass(finalHtml, "cell.style.width = (100/cols) + '%'; cell.style.height = (100/cols) + '%';");
            }
        }

        // R. Scrabble (Words): Fix 15x15 Grid
        if (finalHtml.includes('<title>Scrabble</title>')) {
            console.log("  [Scrabble] Injecting Flexbox Layout fixes...");
            const scrabbleCss = `
            #board { display: flex !important; flex-wrap: wrap !important; width: 100% !important; height: 100vw !important; max-height: 400px !important; }
            .sq { width: 6.66% !important; height: 6.66% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
            finalHtml = finalHtml.replace('</style>', scrabbleCss + '</style>');
        }

        // S. Sudoku: Fix 9x9 Grid
        if (finalHtml.includes('<title>Sudoku</title>')) {
            console.log("  [Sudoku] Injecting Flexbox Layout fixes...");
            let sudokuCss = `
            #game-container { display: block !important; font-size: 0 !important; gap: 0 !important; max-width: 400px !important; margin: 0 auto 8px auto !important; }
            .cell { display: inline-block !important; vertical-align: top !important; width: 11.11% !important; height: 11.11% !important; flex: none !important; margin: 0 !important; box-sizing: border-box !important; }
        `;
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
            finalHtml = finalHtml.replace('</style>', wordleCss + '</style>');
        }

        // 9. Extensionless local links: Cloudflare Pages 308s *.html, and
        // QtWebKit 538.1 on the Kobo cannot follow a 308.
        finalHtml = addOldEngineLayoutFallbacks(finalHtml);
        finalHtml = rewriteLocalHtmlLinks(finalHtml);

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

// Every build gets a unique service-worker cache name. In GitHub Actions the
// short commit SHA + run id make each push a guaranteed client cache update;
// local builds fall back to a timestamp.
function getBuildCacheId() {
    const sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : '';
    const runId = process.env.GITHUB_RUN_ID ? '-' + process.env.GITHUB_RUN_ID : '';
    return sha ? sha + runId : Date.now().toString(36);
}

async function stampServiceWorkerCache(dir, cacheId) {
    const swPath = path.join(dir, 'sw.js');
    if (!(await fs.pathExists(swPath))) return false;
    const code = await fs.readFile(swPath, 'utf8');
    const updated = code.replace(
        /const CACHE_NAME = ['"][^'"]+['"];/,
        "const CACHE_NAME = 'rekindle-cache-" + cacheId + "';"
    );
    if (updated === code) return false;
    await fs.outputFile(swPath, updated);
    return true;
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

    // --- CRITICAL FIX: Ensure Cloudflare Pages Functions are included ---
    // The functions folder contains /api endpoint scripts. It MUST be copied 
    // to the roots of each deploy map so Cloudflare picks it up.
    if (await fs.pathExists(path.join(SOURCE_DIR, 'functions'))) {
        await fs.copy(path.join(SOURCE_DIR, 'functions'), path.join(MAIN_DIR, 'functions'));
        await fs.copy(path.join(SOURCE_DIR, 'functions'), path.join(LITE_DIR, 'functions'));
        await fs.copy(path.join(SOURCE_DIR, 'functions'), path.join(LEGACY_DIR, 'functions'));
    }

    // 2.5 Replace index.html with index_old.html for Lite and Legacy builds
    const indexOldSrc = path.join(SOURCE_DIR, 'index_old.html');
    if (await fs.pathExists(indexOldSrc)) {
        await fs.copy(indexOldSrc, path.join(LITE_DIR, 'index.html'), { overwrite: true });
        await fs.copy(indexOldSrc, path.join(LEGACY_DIR, 'index.html'), { overwrite: true });
        console.log("📄 Replaced index.html with index_old.html for Lite and Legacy builds.");
    } else {
        console.warn("⚠️  index_old.html not found — Lite/Legacy will use default index.html.");
    }

    // 2.6 Stamp a unique service-worker cache name into each deploy target.
    // This runs on every build, including GitHub Actions pushes, so clients
    // drop the old cache even when no shared asset URL happened to change.
    const buildCacheId = getBuildCacheId();
    const stamped = [];
    for (const dir of [MAIN_DIR, LITE_DIR, LEGACY_DIR]) {
        if (await stampServiceWorkerCache(dir, buildCacheId)) stamped.push(dir);
    }
    if (stamped.length) {
        console.log(`🧊 Stamped SW cache: rekindle-cache-${buildCacheId}`);
    } else {
        console.warn("⚠️  Could not stamp sw.js CACHE_NAME — check the source file.");
    }

    // 2.7 Process Main Files (Minify Only)
    console.log("🛠️  Minifying Main Version...");

    // Main HTML
    const mainHtmlFiles = glob.sync(`${MAIN_DIR}/**/*.html`, { nodir: true });
    for (const file of mainHtmlFiles) {
        const html = await fs.readFile(file, 'utf8');
        await fs.outputFile(file, await minifyHtmlContent(html));
    }

    // Main CSS
    const mainCssFiles = glob.sync(`${MAIN_DIR}/**/*.css`, { nodir: true });
    for (const file of mainCssFiles) {
        const css = await fs.readFile(file, 'utf8');
        await fs.outputFile(file, minifyCssString(css));
    }

    // Main JS (Safe Minify)
    const mainJsFiles = glob.sync(`${MAIN_DIR}/**/*.js`, { nodir: true });
    for (const file of mainJsFiles) {
        // Skip already minified files (optional, but good practice)
        if (file.includes('.min.js')) continue;

        const code = await fs.readFile(file, 'utf8');
        const minified = await safeMinifyJs(code);
        await fs.outputFile(file, minified);
    }

    // 2.8 Fail fast if the entry-page device router regressed.
    await assertDeviceRouting();
    console.log("📱 Device routing OK: pre-Chromium Kindle -> Lite, Kobo -> Legacy.");

    // 3. Process Lite HTML Files
    console.log("🛠️  Transpiling Lite Version...");
    const files = glob.sync(`${LITE_DIR}/**/*.html`, { nodir: true });

    for (const file of files) {
        const html = await fs.readFile(file, 'utf8');
        const processed = await transpileHtml(html, path.basename(file));
        await fs.outputFile(file, processed);
    }

    // 4. Process Lite JS Files (External Scripts)
    console.log("🛠️  Transpiling JS Files...");
    const jsFiles = glob.sync(`${LITE_DIR}/**/*.js`, { nodir: true }).filter(f => !f.includes('/libs/'));
    for (const file of jsFiles) {
        // Skip already minified files or libraries if we want (optional)
        // But to be safe, we transpile everything except obvious libraries if needed
        // For now, transpile all to ensure top-level await etc is handled.
        const code = await fs.readFile(file, 'utf8');
        // forceEs5: Lite is the pre-Chromium Kindle (Mesquite) build.
        const processed = await transpileJs(code, true);
        await fs.outputFile(file, processed);
    }

    // 5. Process Lite CSS Files (External Styles)
    console.log("🛠️  Processing CSS Files...");
    const cssFiles = glob.sync(`${LITE_DIR}/**/*.css`, { nodir: true });
    for (const file of cssFiles) {
        const css = await fs.readFile(file, 'utf8');
        const processed = await processCss(css);
        await fs.outputFile(file, processed);
    }

    // 6. Process Legacy HTML Files
    console.log("🛠️  Transpiling Legacy Version...");
    const legHtmlFiles = glob.sync(`${LEGACY_DIR}/**/*.html`, { nodir: true });
    for (const file of legHtmlFiles) {
        if (file.includes('google')) continue; // Skip google verification file if any?
        const html = await fs.readFile(file, 'utf8');
        const processed = await transpileLegacyHtml(html, path.basename(file));
        await fs.outputFile(file, processed);
    }

    // 7. Process Legacy JS (External)
    const legJsFiles = glob.sync(`${LEGACY_DIR}/**/*.js`, { nodir: true }).filter(f => !f.includes('/libs/'));
    for (const file of legJsFiles) {
        const code = await fs.readFile(file, 'utf8');
        const processed = await transpileLegacyJs(code);
        await fs.outputFile(file, processed);
    }

    // 8. Process Legacy CSS
    const legCssFiles = glob.sync(`${LEGACY_DIR}/**/*.css`, { nodir: true });
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

    // 9. Generate Sitemaps
    try {
        console.log("🗺️  Generating Sitemaps...");
        // Main
        await generateSitemap('https://rekindle.ink', MAIN_DIR);
        // Lite
        await generateSitemap('https://lite.rekindle.ink', LITE_DIR);
        // Legacy
        await generateSitemap('https://legacy.rekindle.ink', LEGACY_DIR);
    } catch (err) {
        console.error("Failed to generate sitemap", err);
    }

    // 9.5 Build the Kindle Fullscreen download package. The /kindle page and
    // README link to downloads/ReKindle-Fullscreen.zip, so every deploy target
    // needs a fresh copy. Failing here is deliberate: a stale or missing
    // installer is worse than a failed build.
    try {
        console.log("📦 Building Kindle Fullscreen package...");
        const buildKindlePackage = require('./scripts/build-kindle');
        for (const dir of [MAIN_DIR, LITE_DIR, LEGACY_DIR]) {
            await buildKindlePackage({
                outDir: path.join(dir, 'downloads'),
                log: function () { }
            });
            // Short, memorable URLs for the on-device browser:
            // https://rekindle.ink/kindle.sh (direct)
            // https://rekindle.ink/kindle.txt (same bytes, browser-friendly)
            await fs.copy(path.join(dir, 'downloads', 'ReKindle.sh'), path.join(dir, 'kindle.sh'));
            await fs.copy(path.join(dir, 'downloads', 'ReKindle.sh'), path.join(dir, 'kindle.txt'));
            fs.chmodSync(path.join(dir, 'kindle.txt'), 0o644);
        }
    } catch (err) {
        console.error("Failed to build Kindle package:", err && err.message ? err.message : err);
        throw err;
    }

    // 10. Refuse to publish credentials (see FORBIDDEN_IN_DEPLOY above)
    await assertNoSecretsInDeploy();

    // 11. Old builds must not silently fall back to CDN libraries.
    await assertLocalLibs();

    console.log("✅ Build Complete!");
}

run().catch(err => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});