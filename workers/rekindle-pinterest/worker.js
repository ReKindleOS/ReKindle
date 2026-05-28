export default {
    async fetch(request, env) {
        const ALLOWED_ORIGINS = [
            "https://rekindle.ink",
            "https://lite.rekindle.ink",
            "https://legacy.rekindle.ink",
            "https://beta.rekindle.ink"
        ];

        const origin = request.headers.get("Origin");
        const isAllowed = ALLOWED_ORIGINS.includes(origin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowed ? origin : "null",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // --- OAuth: Exchange code for token ---
            if (path === "/oauth" && request.method === "POST") {
                const { code, redirect_uri } = await request.json();
                if (!code) {
                    return new Response(JSON.stringify({ error: "Missing authorization code" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }

                const clientId = env.PINTEREST_CLIENT_ID;
                const clientSecret = env.PINTEREST_CLIENT_SECRET;
                if (!clientId || !clientSecret) {
                    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
                        status: 500,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }

                const basicAuth = btoa(`${clientId}:${clientSecret}`);

                const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": `Basic ${basicAuth}`
                    },
                    body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: code,
                        redirect_uri: redirect_uri || "https://rekindle.ink/pinterest.html"
                    })
                });

                const data = await tokenRes.json();
                return new Response(JSON.stringify(data), {
                    status: tokenRes.status,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            // --- OAuth: Refresh token ---
            if (path === "/refresh" && request.method === "POST") {
                const { refresh_token } = await request.json();
                if (!refresh_token) {
                    return new Response(JSON.stringify({ error: "Missing refresh token" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }

                const clientId = env.PINTEREST_CLIENT_ID;
                const clientSecret = env.PINTEREST_CLIENT_SECRET;
                if (!clientId || !clientSecret) {
                    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
                        status: 500,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }

                const basicAuth = btoa(`${clientId}:${clientSecret}`);

                const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": `Basic ${basicAuth}`
                    },
                    body: new URLSearchParams({
                        grant_type: "refresh_token",
                        refresh_token: refresh_token
                    })
                });

                const data = await tokenRes.json();
                return new Response(JSON.stringify(data), {
                    status: tokenRes.status,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            // --- API Proxy ---
            if (path.startsWith("/api/")) {
                const authHeader = request.headers.get("Authorization");
                if (!authHeader) {
                    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
                        status: 401,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }

                // Reconstruct Pinterest API path
                const apiPath = path.replace("/api", "");
                const downstreamUrl = new URL(`https://api.pinterest.com/v5${apiPath}`);
                url.searchParams.forEach((value, key) => {
                    downstreamUrl.searchParams.append(key, value);
                });

                const pinterestRes = await fetch(downstreamUrl.toString(), {
                    method: request.method,
                    headers: {
                        "Authorization": authHeader,
                        "Content-Type": "application/json"
                    }
                });

                const data = await pinterestRes.json();
                return new Response(JSON.stringify(data), {
                    status: pinterestRes.status,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            return new Response("Not found", { status: 404, headers: corsHeaders });

        } catch (e) {
            return new Response(JSON.stringify({ error: "Internal error", details: e.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }
    }
};
