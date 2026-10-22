/*
 * repo.rekindle.ink is the short KPM repository URL. The same Cloudflare Pages
 * project also serves the main app, so this middleware only takes over requests
 * whose Host is repo.rekindle.ink. Everything else falls through unchanged.
 *
 * Attach repo.rekindle.ink as a custom domain to the `rekindle` Pages project
 * (one-time dashboard/DNS step). KPM then uses:
 *
 *   ;kpm add-repo https://repo.rekindle.ink
 *   ;kpm install rekindle
 *
 * The real files live in /downloads/kpm/ so the same URLs keep working as a
 * fallback (https://rekindle.ink/downloads/kpm/repo.json).
 */
export async function onRequest(context) {
    const url = new URL(context.request.url);
    if (url.hostname !== 'repo.rekindle.ink') {
        return context.next();
    }

    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    let assetPath;
    if (url.pathname === '/' || url.pathname === '') {
        assetPath = '/downloads/kpm/repo.json';
    } else if (/^\/[A-Za-z0-9][A-Za-z0-9._-]*\.kpkg$/.test(url.pathname)) {
        assetPath = '/downloads/kpm' + url.pathname;
    } else {
        return new Response('Not found', { status: 404 });
    }

    const asset = await context.env.ASSETS.fetch(new URL(assetPath, url.origin));
    if (!asset.ok) {
        return new Response('Not found', { status: 404 });
    }

    const headers = new Headers(asset.headers);
    headers.set('Cache-Control', 'no-cache');
    if (assetPath.endsWith('.json')) {
        headers.set('Content-Type', 'application/json; charset=utf-8');
    } else {
        headers.set('Content-Type', 'application/octet-stream');
    }

    return new Response(context.request.method === 'HEAD' ? null : asset.body, {
        status: 200,
        headers
    });
}
