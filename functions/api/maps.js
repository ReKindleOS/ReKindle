export async function onRequest(context) {
    const url = new URL(context.request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
        return new Response("Missing url param", { status: 400 });
    }

    // Security: Whitelist allowed domains
    const allowedDomains = [
        "nominatim.openstreetmap.org",
        "router.project-osrm.org"
    ];

    try {
        const u = new URL(targetUrl);
        if (!allowedDomains.includes(u.hostname)) {
            return new Response("Forbidden: Domain not allowed", { status: 403 });
        }
    } catch (e) {
        return new Response("Invalid URL", { status: 400 });
    }

    // Fetch from Upstream
    // Nominatim strictly requires a User-Agent
    const response = await fetch(targetUrl, {
        headers: {
            "User-Agent": "ReKindle-Maps/1.0 (rekindle.ink)"
        }
    });

    // Re-wrap response with CORS headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}
