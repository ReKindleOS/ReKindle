const fs = require('fs-extra');
const glob = require('glob');
const path = require('path');

const DEFAULT_DOMAIN = 'https://beta.rekindle.pages.dev';
// Depending on where this is run from, we usually assume it's run from root via 'node scripts/...'
// But to be safe, let's resolve relative to this file
const ROOT_DIR = path.resolve(__dirname, '..');

const IGNORE_PATTERNS = [
    'google',       // Google Verification
    'pro-admin',    // Admin Tools
    'test',         // Test files
    'mock',         // Mockups
    '404.html',     // Error page (optional, usually excluded)
    'template',     // Templates
    '_',            // Partials like _footer.html
    'settings.html' // Local control panel
];

async function generateSitemap(domain = DEFAULT_DOMAIN, outputDir = ROOT_DIR) {
    console.log(`🔍 Scanning for HTML files in ${ROOT_DIR}...`);
    console.log(`🌐 Using Domain: ${domain}`);
    console.log(`📂 Output Directory: ${outputDir}`);

    const files = glob.sync('*.html', { cwd: ROOT_DIR });
    let count = 0;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    for (const file of files) {
        // checks
        if (IGNORE_PATTERNS.some(pattern => file.includes(pattern))) {
            continue;
        }

        const filePath = path.join(ROOT_DIR, file);
        const stats = await fs.stat(filePath);
        const lastmod = stats.mtime.toISOString().split('T')[0]; // YYYY-MM-DD

        let priority = '0.80';
        if (file === 'index.html') priority = '1.00';

        xml += `  <url>
    <loc>${domain}/${file}</loc>
    <lastmod>${lastmod}</lastmod>
    <priority>${priority}</priority>
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
    console.log(`📍 Saved to: ${outputPath}`);
}

if (require.main === module) {
    generateSitemap().catch(console.error);
}

module.exports = generateSitemap;
