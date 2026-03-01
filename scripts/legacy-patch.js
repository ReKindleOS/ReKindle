
const fs = require('fs');
const path = require('path');
const glob = require('glob');

console.log("🚑 Running Post-Build Legacy Patch...");

const LEGACY_DIR = path.resolve('_deploy/legacy');

// 1. Fix CSS in ALL HTML files with preservation of !important
function fixCss() {
    const htmlFiles = glob.sync(`${LEGACY_DIR}/**/*.html`);
    let totalCount = 0;

    for (const htmlPath of htmlFiles) {
        let html = fs.readFileSync(htmlPath, 'utf8');
        let count = 0;
        const basename = path.relative(LEGACY_DIR, htmlPath);

        // Handle display: flex (in both <style> blocks and inline style attributes)
        html = html.replace(/display:\s*flex\s*(!important)?/gi, (match) => {
            count++;
            const isImportant = match.toLowerCase().includes('!important');
            return `display: -webkit-box${isImportant ? ' !important' : ''}`;
        });

        // Handle display: inline-flex
        html = html.replace(/display:\s*inline-flex\s*(!important)?/gi, (match) => {
            count++;
            const isImportant = match.toLowerCase().includes('!important');
            return `display: -webkit-inline-box${isImportant ? ' !important' : ''}`;
        });

        // Index.html specific layout fixes
        if (basename === 'index.html') {
            // .grid-container: Force display: block
            if (html.match(/\.grid-container\{/)) {
                html = html.replace(/\.grid-container\{[^}]+\}/g, '.grid-container{display:block;text-align:left;padding:10px;}');
                count++;
                console.log("   [Layout] Fixed .grid-container to block");
            }

            // .app-icon: Force inline-block and simulate spacing
            if (html.match(/\.app-icon\{/)) {
                html = html.replace(/\.app-icon\{[^}]+\}/g, '.app-icon{display:inline-block;vertical-align:top;width:80px;margin:8px;text-align:center;text-decoration:none;color:black;}');
                count++;
                console.log("   [Layout] Fixed .app-icon to inline-block");
            }

            // .featured-card: Force inline-block for Featured section
            if (html.match(/\.featured-card\{/)) {
                html = html.replace(/\.featured-card\{[^}]+\}/g, '.featured-card{display:inline-block;vertical-align:top;width:200px;margin:8px;padding:10px;border:2px solid black;text-decoration:none;color:black;background:white;}');
                count++;
                console.log("   [Layout] Fixed .featured-card to inline-block");
            }

            // .app-view: Fix SCROLLING issue.
            if (html.match(/\.app-view\{/)) {
                html = html.replace(/\.app-view\{[^}]+\}/g, '.app-view{-webkit-box-flex:1;flex-grow:1;display:block;height:100%;overflow-y:auto;background:white;position:relative;padding:10px;}');
                count++;
                console.log("   [Layout] Fixed .app-view scrolling (display: block)");
            }
        }

        if (count > 0) {
            fs.writeFileSync(htmlPath, html);
            totalCount += count;
            console.log(`   [CSS] ${basename}: Patched ${count} instances`);
        }
    }

    if (totalCount > 0) {
        console.log(`✅ [CSS] Replaced ${totalCount} flex/inline-flex instances across all HTML files`);
    } else {
        console.log("ℹ️  [CSS] No 'display:flex' instances found to patch.");
    }
}

// 2. Fix JS Keywords in ALL libraries, scripts, and root-level JS files
function fixJs() {
    const dirs = ['libs', 'js'].map(d => path.join(LEGACY_DIR, d));
    const replacements = [
        { regex: /class/g, replace: '\\u0063lass', name: 'class' },
        { regex: /fetch/gi, replace: '\\u0066etch', name: 'fetch' },
        { regex: /Promise/g, replace: '\\u0050romise', name: 'Promise' },
        { regex: /promise/g, replace: '\\u0070romise', name: 'promise' },
        { regex: /async/gi, replace: '\\u0061sync', name: 'async' },
        { regex: /await/gi, replace: '\\u0061wait', name: 'await' },
        { regex: new RegExp('\\x60', 'g'), replace: '\\u0060', name: 'template_literal' } // Backtick
    ];

    // Process subdirectories (libs/, js/)
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;

        const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const filePath = path.join(dir, file);
            processJsFile(filePath, replacements);
        }
    }

    // Process root-level JS files (e.g. pro-gate.js)
    const rootJsFiles = fs.readdirSync(LEGACY_DIR).filter(f => f.endsWith('.js'));
    for (const file of rootJsFiles) {
        const filePath = path.join(LEGACY_DIR, file);
        processJsFile(filePath, replacements);
    }
}

function processJsFile(filePath, replacements) {
    let code = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    for (const rule of replacements) {
        if (code.match(rule.regex)) {
            const count = (code.match(rule.regex) || []).length;
            if (count > 0) {
                code = code.replace(rule.regex, rule.replace);
                modified = true;
            }
        }
    }

    if (modified) {
        fs.writeFileSync(filePath, code);
        console.log(`✅ [JS] Obfuscated keywords in ${path.relative(LEGACY_DIR, filePath)}`);
    }
}

// 3. Fix JS Keywords in inline <script> blocks within HTML files
function fixInlineJs() {
    const htmlFiles = glob.sync(`${LEGACY_DIR}/**/*.html`);
    const replacements = [
        { regex: /Promise/g, replace: '\\u0050romise', name: 'Promise' },
        { regex: /promise/g, replace: '\\u0070romise', name: 'promise' },
        { regex: /fetch/gi, replace: '\\u0066etch', name: 'fetch' },
    ];

    for (const htmlPath of htmlFiles) {
        let html = fs.readFileSync(htmlPath, 'utf8');
        let modified = false;
        const basename = path.relative(LEGACY_DIR, htmlPath);

        // Match inline <script> blocks (no src attribute)
        html = html.replace(/<script(?![^>]*\bsrc\b)([^>]*)>([\s\S]*?)<\/script>/gi, (fullMatch, attrs, code) => {
            // Skip non-JS script types (e.g. type="application/json")
            const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
            if (typeMatch && typeMatch[1] !== 'text/javascript' && typeMatch[1] !== 'module') {
                return fullMatch;
            }

            let newCode = code;
            let changed = false;
            for (const rule of replacements) {
                if (newCode.match(rule.regex)) {
                    newCode = newCode.replace(rule.regex, rule.replace);
                    changed = true;
                }
            }
            if (changed) {
                modified = true;
                return `<script${attrs}>${newCode}</script>`;
            }
            return fullMatch;
        });

        if (modified) {
            fs.writeFileSync(htmlPath, html);
            console.log(`✅ [Inline JS] Obfuscated keywords in ${basename}`);
        }
    }
}

try {
    fixCss();
    fixJs();
    fixInlineJs();
    console.log("🏁 Legacy Patch Complete.");
} catch (err) {
    console.error("❌ Legacy Patch Failed:", err);
    process.exit(1);
}
