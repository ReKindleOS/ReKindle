export default {
    async fetch(request, env) {
        // SECURITY: Only allow your specific domains
        const ALLOWED_ORIGINS = [
            "https://rekindle.ink",
            "https://lite.rekindle.ink",
            "https://legacy.rekindle.ink",
            "https://beta.rekindle.pages.dev"
        ];

        const origin = request.headers.get("Origin");

        // Allow localhost for development if needed, or strict mode
        // const isAllowed = ALLOWED_ORIGINS.includes(origin) || (origin && origin.includes('localhost'));
        const isAllowed = ALLOWED_ORIGINS.includes(origin) || (origin && origin.includes('localhost'));

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowed ? origin : "null",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const API_KEY = env.TMDB_API_KEY;

        if (!API_KEY) {
            return new Response(JSON.stringify({ error: "Server misconfigured: No API Key." }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        // Proxy Logic
        // Allow /search/multi, /tv/*, /movie/*
        const path = url.pathname;
        if (
            path === "/search/multi" ||
            path.startsWith("/tv/") ||
            path.startsWith("/movie/")
        ) {
            // Reconstruct the downstream URL
            // Ensure we don't duplicate query params or slashes inappropriately
            const downstreamUrl = new URL(`https://api.themoviedb.org/3${path}`);

            // Copy all existing params (like query, page, etc)
            url.searchParams.forEach((value, key) => {
                downstreamUrl.searchParams.append(key, value);
            });

            // Inject API Key
            downstreamUrl.searchParams.append("api_key", API_KEY);
            downstreamUrl.searchParams.append("include_adult", "false"); // Force safety

            try {
                const tmdbRes = await fetch(downstreamUrl.toString());
                const data = await tmdbRes.json();

                return new Response(JSON.stringify(data), {
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            } catch (e) {
                return new Response(JSON.stringify({ error: "Upstream error", details: e.message }), {
                    status: 502,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }
        }

        return new Response("Not found", { status: 404, headers: corsHeaders });
    },
};
