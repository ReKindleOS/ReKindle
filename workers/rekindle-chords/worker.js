export default {
  async fetch(request, env, ctx) {
    // Public read-only chord data. Do not gate on Origin: Kindle WebKit can
    // send a missing/"null" Origin, which used to produce a CORS failure that
    // surfaced in the app as "Load failed".
    const allowedOrigins = [
      "https://beta.rekindle.ink",
      "https://rekindle.ink",
      "https://lite.rekindle.ink",
      "https://legacy.rekindle.ink",
    ];
    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const cmd = url.searchParams.get("cmd") || "search"; // Default to search if ambiguous
    const query = url.searchParams.get("q");
    const targetUrl = url.searchParams.get("url");

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    function jsonResponse(data, ttl) {
      return new Response(JSON.stringify(data), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + ttl,
        },
      });
    }

    try {
      if (cmd === "search") {
        if (!query) throw new Error("No query provided for search");

        // GuitareTab Search
        const gtSearchUrl = `https://www.guitaretab.com/fetch/?type=tab&query=${encodeURIComponent(query)}`;
        const gtRes = await fetch(gtSearchUrl, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
        const gtHtml = await gtRes.text();

        // Parse results from div.gt-list
        // We need title, artist, link.
        // Structure typically: 
        // <a href="/o/oasis/13758.html" class="gt-link gt-link--primary" ...>Wonderwall tab (ver 3)</a>

        const results = [];
        // Regex to find links. This is a bit rough but should work for the list.
        // link format: /letter/artist/id.html
        const linkRegex = /<a[^>]+href=["'](\/[a-z0-9]\/[^"']+\/[^"']+\.html)["'][^>]*class=["']gt-link[^"']*gt-link--primary[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(gtHtml)) !== null) {
          const link = "https://www.guitaretab.com" + match[1]; // match[1] is relative url
          const titleRaw = match[2].trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/<[^>]+>/g, ''); // match[2] is text

          results.push({
            title: titleRaw,
            artist: "Unknown", // GuitareTab list often groups by artist text headings, harder to parse with regex. We might settle for just title for now.
            url: link,
            source: "GuitareTab"
          });
        }

        const response = jsonResponse(results, 21600);
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

      } else if (cmd === "get") {
        if (!targetUrl) throw new Error("No url provided for get");

        const pageRes = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        const pageHtml = await pageRes.text();
        let content = "";

        // GuitareTab Content Extraction
        if (new URL(targetUrl).hostname === 'guitaretab.com' || new URL(targetUrl).hostname.endsWith('.guitaretab.com')) {
          const match = pageHtml.match(/<section[^>]+class=["'][^"']*js-tab[^"']*["'][^>]*>([\s\S]*?)<\/section>/i) ||
            pageHtml.match(/<pre[^>]+class=["'][^"']*js-tab-content[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i);
          if (match) content = match[1];
        }

        // Clean up
        content = content
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/<[^>]*>/g, "");

        if (!content) throw new Error("Could not parse content");

        const response = jsonResponse({ content: content, source: targetUrl }, 86400);
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }

      throw new Error("Invalid command");

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
