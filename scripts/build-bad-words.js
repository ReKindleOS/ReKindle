// Bundles scripts/bad-words-src.js + obscenity into a self-contained IIFE
// targeting ES2019 (Kindle Chromium 75 / no optional-chaining / no nullish-coalescing).
// Run via: npm run build:badwords
const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
    entryPoints: [path.join(__dirname, 'bad-words-src.js')],
    bundle: true,
    format: 'iife',
    target: ['es2019'],
    platform: 'browser',
    outfile: path.join(__dirname, '..', 'bad_words.js'),
}).then(function() {
    console.log('[OK] bad_words.js rebuilt from obscenity');
}).catch(function(err) {
    console.error('Build failed:', err);
    process.exit(1);
});
