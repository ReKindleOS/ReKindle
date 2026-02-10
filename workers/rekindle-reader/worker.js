/**
 * REKINDLE READER - READABILITY WORKER
 * Deployed to Cloudflare Workers
 * 
 * Replaces Jina AI / FrogFind for article extraction.
 * Uses Mozilla Readability + linkedom for clean article parsing.
 * 
 * Usage: GET /?url=https://example.com/article
 * Returns: { title, content, textContent, byline, siteName, excerpt }
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";



const ALLOWED_ORIGINS = [
    "https://beta.rekindle.pages.dev",
    "https://rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default {
    async fetch(request) {
        const origin = request.headers.get("Origin");
        const isAllowed = ALLOWED_ORIGINS.includes(origin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowed ? origin : "null",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            const url = new URL(request.url);

            // --- SEARCH ENDPOINT ---
            if (url.pathname === "/search") {
                return handleSearch(url, corsHeaders);
            }

            // --- ARTICLE READABILITY ENDPOINT (default) ---
            const targetUrl = url.searchParams.get("url");

            if (!targetUrl) {
                return new Response(
                    JSON.stringify({ error: "Missing 'url' query parameter" }),
                    { status: 400, headers: corsHeaders }
                );
            }

            // 1. Fetch the page HTML with a timeout
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            let response;
            try {
                response = await fetch(targetUrl, {
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                    },
                    signal: controller.signal,
                    redirect: "follow",
                });
            } catch (err) {
                clearTimeout(timeout);
                throw err;
            }

            clearTimeout(timeout);

            if (!response.ok) {
                // If upstream fails, we should still return JSON error, not crash
                return new Response(
                    JSON.stringify({ error: `Upstream HTTP ${response.status}`, details: response.statusText }),
                    { status: response.status >= 500 ? 502 : 400, headers: corsHeaders }
                );
            }

            const html = await response.text();

            if (!html || html.length < 100) {
                return new Response(
                    JSON.stringify({ error: "Empty or too-short response from upstream" }),
                    { status: 422, headers: corsHeaders }
                );
            }

            // 2. Parse with linkedom + Readability
            const { document } = parseHTML(html);

            // Set the document URL for resolving relative links
            if (document.baseURI !== targetUrl) {
                const base = document.createElement("base");
                base.href = targetUrl;
                document.head.appendChild(base);
            }

            const reader = new Readability(document);
            const article = reader.parse();

            if (!article) {
                // Readability couldn't extract — return raw text fallback
                const bodyText = document.body ? document.body.textContent : "";
                return new Response(
                    JSON.stringify({
                        title: document.title || targetUrl,
                        content: `<p>${bodyText.substring(0, 5000)}</p>`,
                        textContent: bodyText.substring(0, 5000),
                        byline: null,
                        siteName: null,
                        excerpt: null,
                        fallback: true,
                    }),
                    { status: 200, headers: corsHeaders }
                );
            }

            // 3. Return clean article JSON
            return new Response(
                JSON.stringify({
                    title: article.title,
                    content: article.content,
                    textContent: article.textContent,
                    byline: article.byline,
                    siteName: article.siteName,
                    excerpt: article.excerpt,
                }),
                { status: 200, headers: corsHeaders }
            );

        } catch (error) {
            console.error("Reader Worker Error:", error.message, error.stack);

            let status = 500;
            let message = "Failed to fetch and parse article";

            if (error.name === "AbortError") {
                status = 504;
                message = "Request timed out (15s)";
            }

            return new Response(
                JSON.stringify({ error: message, detail: error.message }),
                { status, headers: corsHeaders }
            );
        }
    },
};

// --- SEARCH HANDLER ---
async function handleSearch(url, headers) {
    const query = url.searchParams.get("q");

    if (!query) {
        return new Response(
            JSON.stringify({ error: "Missing 'q' query parameter" }),
            { status: 400, headers }
        );
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        // Use DuckDuckGo HTML (bot-friendly, no CAPTCHA)
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const response = await fetch(searchUrl, {
            method: "POST",
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.5",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `q=${encodeURIComponent(query)}`,
            signal: controller.signal,
            redirect: "follow",
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Search HTTP ${response.status}`);
        }

        const html = await response.text();
        const { document } = parseHTML(html);

        const results = [];

        // DuckDuckGo HTML uses .result class for each result
        const resultDivs = document.querySelectorAll(".result");

        for (const div of resultDivs) {
            // Title link has class .result__a
            const titleLink = div.querySelector(".result__a");
            if (!titleLink) continue;

            const title = titleLink.textContent.trim();
            let href = titleLink.getAttribute("href") || "";

            // DDG wraps URLs in a redirect — extract the real URL
            if (href.includes("uddg=")) {
                try {
                    const uddg = new URL(href, "https://duckduckgo.com").searchParams.get("uddg");
                    if (uddg) href = uddg;
                } catch (_) { }
            }

            if (!href.startsWith("http")) continue;
            if (!title) continue;

            // Snippet has class .result__snippet
            const snippetEl = div.querySelector(".result__snippet");
            const snippet = snippetEl ? snippetEl.textContent.trim() : "";

            // Skip duplicates
            if (results.some(r => r.url === href)) continue;

            results.push({
                title,
                url: href,
                snippet: snippet.substring(0, 300),
            });
        }

        return new Response(
            JSON.stringify({ query, results }),
            { status: 200, headers }
        );

    } catch (error) {
        console.error("Search Error:", error.message);

        let status = 500;
        let message = "Search failed";

        if (error.name === "AbortError") {
            status = 504;
            message = "Search timed out (10s)";
        }

        return new Response(
            JSON.stringify({ error: message, detail: error.message }),
            { status, headers }
        );
    }
}

