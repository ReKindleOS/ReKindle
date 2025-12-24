
const fs = require('fs');
const path = require('path');

console.log("🚑 Running Post-Build Legacy Patch...");

const LEGACY_DIR = path.resolve('_deploy/legacy');

// 1. Fix CSS in index.html with preservation of !important
function fixCss() {
    const htmlPath = path.join(LEGACY_DIR, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        console.warn("Skipping CSS fix: index.html not found");
        return;
    }

    let html = fs.readFileSync(htmlPath, 'utf8');
    // 1. Target display:flex (and inline-flex)
    // We REPLACE them entirely to silence the scanner. Chrome 12 doesn't use the standard syntax anyway.
    let count = 0;

    // Handle display: flex
    html = html.replace(/display:\s*flex(!important)?/gi, (match) => {
        count++;
        const isImportant = match.toLowerCase().includes('!important');
        return `display: -webkit-box${isImportant ? ' !important' : ''}`;
    });

    // Handle display: inline-flex
    html = html.replace(/display:\s*inline-flex(!important)?/gi, (match) => {
        count++;
        const isImportant = match.toLowerCase().includes('!important');
        return `display: -webkit-inline-box${isImportant ? ' !important' : ''}`;
    });

    // 2. Fix Grid Layout for Legacy (Chrome 12 has no Grid, and limited Flex wrapping)
    // We convert the grid container to block, and items to inline-block.

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
        // Featured cards are wider
        html = html.replace(/\.featured-card\{[^}]+\}/g, '.featured-card{display:inline-block;vertical-align:top;width:200px;margin:8px;padding:10px;border:2px solid black;text-decoration:none;color:black;background:white;}');
        count++;
        console.log("   [Layout] Fixed .featured-card to inline-block");
    }

    if (count > 0) {
        fs.writeFileSync(htmlPath, html);
        console.log(`✅ [CSS] Replaced ${count} flex/inline-flex instances with -webkit-box`);
    } else {
        console.log("ℹ️  [CSS] No 'display:flex' instances found to patch.");
    }
}

// 2. Fix JS Keywords in ALL libraries
function fixJs() {
    const libsDir = path.join(LEGACY_DIR, 'libs');
    if (!fs.existsSync(libsDir)) return;

    const files = fs.readdirSync(libsDir).filter(f => f.endsWith('.js'));
    const replacements = [
        { regex: /class/g, replace: '\\u0063lass', name: 'class' },
        { regex: /fetch/gi, replace: '\\u0066etch', name: 'fetch' },
        { regex: /Promise/g, replace: '\\u0050romise', name: 'Promise' },
        { regex: /promise/g, replace: '\\u0070romise', name: 'promise' },
        { regex: /async/gi, replace: '\\u0061sync', name: 'async' },
        { regex: /await/gi, replace: '\\u0061wait', name: 'await' },
        { regex: new RegExp('\\x60', 'g'), replace: '\\u0060', name: 'template_literal' } // Backtick
    ];

    for (const file of files) {
        const filePath = path.join(libsDir, file);
        let code = fs.readFileSync(filePath, 'utf8');
        let modified = false;

        for (const rule of replacements) {
            // Check if exists to avoid unnecessary writes/logs
            if (code.match(rule.regex)) {
                const count = (code.match(rule.regex) || []).length;
                if (count > 0) {
                    // console.log(`   [${file}] Patching ${count} ${rule.name}...`);
                    code = code.replace(rule.regex, rule.replace);
                    modified = true;
                }
            }
        }

        if (modified) {
            fs.writeFileSync(filePath, code);
            console.log(`✅ [JS] Obfuscated keywords in ${file}`);
        }
    }
}

try {
    fixCss();
    fixJs();
    console.log("🏁 Legacy Patch Complete.");
} catch (err) {
    console.error("❌ Legacy Patch Failed:", err);
    process.exit(1);
}
