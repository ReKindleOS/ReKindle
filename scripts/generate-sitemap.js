const fs = require('fs-extra');
const glob = require('glob');
const path = require('path');
const { execSync } = require('child_process');
const { PAGES, noindexSlugs, pathFor } = require('./seo-pages');

const DEFAULT_DOMAIN = 'https://rekindle.ink';
// Depending on where this is run from, we usually assume it's run from root via 'node scripts/...'
// But to be safe, let's resolve relative to this file
const ROOT_DIR = path.resolve(__dirname, '..');

/*
 * sitemap.xml generator.
 *
 * Rules (2026-11-10 SEO pass):
 *   - only pages a searcher should land on: anything marked noindex in
 *     scripts/seo-pages.js is skipped, so the sitemap and the <meta robots> tags
 *     can never disagree. That is what stopped /login, /settings, /probe,
 *     /moderation and /index_old being submitted while simultaneously marked
 *     noindex (Search Console "Excluded by 'noindex' tag").
 *   - <lastmod> is the file's last commit date, not "today". A sitemap whose
 *     lastmod changes on every build teaches Google to ignore lastmod entirely.
 *   - one sitemap per host: rekindle.ink, lite.rekindle.ink and
 *     legacy.rekindle.ink each get URLs for their own domain. All of them point
 *     <link rel="canonical"> at rekindle.ink, so the alternates consolidate.
 */

// Files that are never real pages, regardless of metadata.
const IGNORE_PATTERNS = [
    'google',       // Google Verification
    'pro-admin',    // Admin Tools
    'test',         // Test files
    'mock',         // Mockups
    '404.html',     // Error page - served with a 404 status
    'template'      // Templates
];

function isIgnored(file) {
    if (/^_/.test(file)) return true;              // partials like _footer.html
    return IGNORE_PATTERNS.some(pattern => file.includes(pattern));
}

// Last commit date per file, built once per process (three calls per build).
let gitDates = null;

function buildGitDates() {
    const dates = {};
    try {
        const out = execSync('git log --pretty=format:%cs --name-only', {
            cwd: ROOT_DIR,
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString();
        let current = '';
        for (const raw of out.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            if (/^\d{4}-\d{2}-\d{2}$/.test(line)) { current = line; continue; }
            if (current && !dates[line]) dates[line] = current;
        }
    } catch (e) {
        // Not a git checkout (or git missing): fall back to mtime below.
    }
    return dates;
}

function lastModified(file) {
    if (gitDates === null) gitDates = buildGitDates();
    if (gitDates[file]) return gitDates[file];
    try {
        return fs.statSync(path.join(ROOT_DIR, file)).mtime.toISOString().split('T')[0];
    } catch (e) {
        return '';
    }
}

async function generateSitemap(domain = DEFAULT_DOMAIN, outputDir = ROOT_DIR) {
    console.log(`🔍 Scanning for HTML files in ${ROOT_DIR}...`);
    console.log(`🌐 Using Domain: ${domain}`);
    console.log(`📂 Output Directory: ${outputDir}`);

    const skip = new Set(noindexSlugs());
    const files = glob.sync('*.html', { cwd: ROOT_DIR }).sort();
    let count = 0;
    const skipped = [];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    for (const file of files) {
        if (isIgnored(file)) continue;

        const slug = file.replace(/\.html$/, '');
        if (skip.has(slug)) { skipped.push(file); continue; }

        // Clean URL (drop .html); index.html is the site root.
        const cleanUrl = pathFor(slug);
        const priority = slug === 'index' ? '1.00' : (PAGES[slug] && PAGES[slug].type === 'info' ? '0.60' : '0.80');
        const lastmod = lastModified(file);

        xml += `  <url>
    <loc>${domain}${cleanUrl}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <priority>${priority}</priority>
  </url>
`;
        count++;
    }

    xml += `</urlset>`;

    // Ensure output directory exists if it's not root
    if (outputDir !== ROOT_DIR) {
        await fs.ensureDir(outputDir);
    }

    const outputPath = path.join(outputDir, 'sitemap.xml');
    await fs.writeFile(outputPath, xml);

    console.log(`✅ Generated sitemap.xml with ${count} URLs`);
    if (skipped.length) console.log(`   skipped (noindex): ${skipped.join(', ')}`);
    console.log(`📍 Saved to: ${outputPath}`);
}

if (require.main === module) {
    generateSitemap(process.argv[2] || DEFAULT_DOMAIN, process.argv[3] || ROOT_DIR).catch(console.error);
}

module.exports = generateSitemap;
module.exports.lastModified = lastModified;
