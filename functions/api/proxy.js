export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    try {
        // Prepare request without browser-specific CORS triggering headers
        const headers = new Headers(request.headers);
        headers.delete('Origin');
        headers.delete('Referer');

        // MangaDex specific: They might require a User-Agent
        if (!headers.has('User-Agent')) {
            headers.set('User-Agent', 'ReKindle-Manga-Proxy/1.0');
        }

        const res = await fetch(targetUrl, {
            method: request.method,
            headers: headers
        });

        // Re-construct response to inject CORS allow headers back to the browser
        const responseData = await res.arrayBuffer();
        const response = new Response(responseData, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers
        });

        response.headers.set('Access-Control-Allow-Origin', '*');
        response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', '*');

        return response;
    } catch (e) {
        return new Response('Proxy Error: ' + e.message, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
}
