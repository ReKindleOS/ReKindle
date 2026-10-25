/**
 * KPM repository host (repo.rekindle.ink).
 *
 * The manifest and packages are static files on the main Pages project at
 * /downloads/kpm/. This Worker is attached to repo.rekindle.ink only, so the
 * short KPM URL (https://repo.rekindle.ink) keeps working with 200 responses
 * without a Pages Function.
 *
 * Why not functions/_middleware.js: Pages runs middleware for EVERY request to
 * the project, not just the repo host. That added ~95k Worker invocations/day in
 * Oct 2026 (see docs/agent/usage-limits.md). This Worker only runs for the
 * ~1k/day repo-host requests.
 *
 * Deploy from workers/rekindle-kpm:
 *   npx wrangler deploy
 */

const ORIGIN = 'https://rekindle.ink';
const REPO_PREFIX = '/downloads/kpm';

// Pure and exported so scripts/test-kindle.js can check the mapping without a
// Worker runtime. Only the manifest and single-segment .kpkg names are allowed:
// no slashes, no traversal, no query handling.
export function mapRepoPath(pathname) {
    if (pathname === '/' || pathname === '' || pathname === '/repo.json') {
        return REPO_PREFIX + '/repo.json';
    }
    const match = /^\/([A-Za-z0-9][A-Za-z0-9._-]*\.kpkg)$/.exec(pathname);
    if (!match) return null;
    return REPO_PREFIX + '/' + match[1];
}

export default {
    async fetch(request) {
        const url = new URL(request.url);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', {
                status: 405,
                headers: { Allow: 'GET, HEAD' }
            });
        }

        const assetPath = mapRepoPath(url.pathname);
        if (!assetPath) {
            return new Response('Not found', { status: 404 });
        }

        const asset = await fetch(ORIGIN + assetPath);
        // Pages answers a missing asset with the app's index.html (200 text/html),
        // so a plain res.ok check would serve a web page as a .kpkg. Only accept a
        // real manifest or a real binary package.
        const upstreamType = (asset.headers.get('Content-Type') || '').toLowerCase();
        if (!asset.ok || upstreamType.indexOf('text/html') === 0) {
            return new Response('Not found', { status: 404 });
        }

        const isJson = assetPath.slice(-5) === '.json';
        const headers = new Headers();
        headers.set('Content-Type', isJson ? 'application/json; charset=utf-8' : 'application/octet-stream');
        // The manifest must be re-read so a new package version is discovered;
        // .kpkg filenames are versioned and can be cached hard.
        headers.set('Cache-Control', isJson ? 'no-cache' : 'public, max-age=31536000, immutable');
        headers.set('X-Content-Type-Options', 'nosniff');

        return new Response(request.method === 'HEAD' ? null : asset.body, {
            status: 200,
            headers
        });
    }
};
