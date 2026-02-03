export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // --- CORS Handle ---
        // --- CORS Handle ---
        const allowedOrigins = [
            "https://beta.rekindle.pages.dev",
            "https://rekindle.ink",
            "https://lite.rekindle.ink",
            "https://legacy.rekindle.ink",
        ];
        const origin = request.headers.get("Origin");
        const isAllowed = allowedOrigins.indexOf(origin) !== -1;

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowed ? origin : allowedOrigins[1],
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Substack-SID, X-Substack-Target",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // --- Proxy Logic ---
        // Route from /api/... to https://substack.com/api/v1/...
        if (url.pathname.startsWith("/api/")) {
            const substackPath = url.pathname.replace("/api/", "/api/v1/");

            // Allow dynamic targeting for publication subdomains
            const targetDomain = request.headers.get("X-Substack-Target") || "substack.com";
            const substackUrl = `https://${targetDomain}${substackPath}${url.search}`;

            const sid = request.headers.get("X-Substack-SID");

            if (!sid && !url.pathname.includes("/subscriptions")) {
                // Some endpoints might be public, but usually we want the SID
                // Allow through to see what happens, or block? 
                // Let's let it through but we won't have the cookie.
            }

            try {
                const newHeaders = new Headers(request.headers);
                newHeaders.set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

                // CRITICAL: Inject the cookie
                if (sid) {
                    newHeaders.set("Cookie", `substack.sid=${sid}`);
                }

                // Remove headers that might cause issues
                newHeaders.delete("Host");
                newHeaders.delete("Host");
                newHeaders.delete("X-Substack-SID");
                newHeaders.delete("X-Substack-Target");

                const response = await fetch(substackUrl, {
                    method: request.method,
                    headers: newHeaders,
                    body: request.method === "POST" ? await request.text() : undefined,
                });

                // --- Respond with CORS ---
                const responseHeaders = new Headers(response.headers);
                Object.keys(corsHeaders).forEach((k) => responseHeaders.set(k, corsHeaders[k]));

                // Filter out headers that might cause issues on the client
                responseHeaders.delete("Set-Cookie");

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                });
            } catch (err) {
                return new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: corsHeaders,
                });
            }
        }

        return new Response("ReKindle Substack Proxy Worker", { status: 200 });
    },
};
