/**
 * REKINDLE READWISE PROXY WORKER
 * Proxies Readwise API v2 (Highlights) and v3 (Reader) requests.
 *
 * The client sends the user's personal Readwise token in the
 * X-Readwise-Token header. We forward it as Authorization: Token <token>.
 */

const ALLOWED_ORIGINS = [
    "https://beta.rekindle.ink",
    "https://rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
];

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin");
        const isAllowed = ALLOWED_ORIGINS.includes(origin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowed ? origin : "null",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Readwise-Token",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const token = request.headers.get("X-Readwise-Token");
        if (!token) {
            return new Response(
                JSON.stringify({ error: "Missing X-Readwise-Token header" }),
                { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }

        try {
            let targetUrl;
            const path = url.pathname;

            if (path === "/reader") {
                // Readwise Reader API v3 - Document LIST
                targetUrl = new URL("https://readwise.io/api/v3/list/");
                // Pass through query params (location, pageCursor, category, tag, etc.)
                url.searchParams.forEach((value, key) => {
                    targetUrl.searchParams.set(key, value);
                });
            } else if (path === "/highlights") {
                // Readwise API v2 - Export
                targetUrl = new URL("https://readwise.io/api/v2/export/");
                url.searchParams.forEach((value, key) => {
                    targetUrl.searchParams.set(key, value);
                });
            } else if (path === "/review") {
                // Readwise API v2 - Daily Review
                targetUrl = new URL("https://readwise.io/api/v2/review/");
            } else if (path === "/auth") {
                // Readwise API v2 - Auth check
                targetUrl = new URL("https://readwise.io/api/v2/auth/");
            } else {
                return new Response("Not found", { status: 404, headers: corsHeaders });
            }

            const response = await fetch(targetUrl.toString(), {
                method: "GET",
                headers: {
                    "Authorization": `Token ${token}`,
                    "Content-Type": "application/json",
                    "User-Agent": "ReKindle-Readwise-Proxy/1.0",
                },
            });

            // Forward the response body and status, but inject CORS headers
            const responseHeaders = new Headers(response.headers);
            Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
            // Only force JSON content-type when there is a body to parse
            if (response.status !== 204) {
                responseHeaders.set("Content-Type", "application/json");
            }

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ error: "Upstream error", detail: err.message }),
                { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }
    },
};
