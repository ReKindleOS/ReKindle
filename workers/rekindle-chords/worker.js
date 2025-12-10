export default {
  async fetch(request, env, ctx) {
    const allowedOrigins = [
      "https://rekindle.ink",
    ];
    const origin = request.headers.get("Origin");
    const isAllowed = allowedOrigins.includes(origin);

    const corsHeaders = {
      "Access-Control-Allow-Origin": isAllowed ? origin : "null",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!isAllowed) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const cmd = url.searchParams.get("cmd") || "search"; // Default to search if ambiguous
    const query = url.searchParams.get("q");
    const targetUrl = url.searchParams.get("url");

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
          const titleRaw = match[2].trim().replace(/<[^>]+>/g, ''); // match[2] is text

          results.push({
            title: titleRaw,
            artist: "Unknown", // GuitareTab list often groups by artist text headings, harder to parse with regex. We might settle for just title for now.
            url: link,
            source: "GuitareTab"
          });
        }

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

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
        if (targetUrl.includes("guitaretab.com")) {
          const match = pageHtml.match(/<section[^>]+class=["'][^"']*js-tab[^"']*["'][^>]*>([\s\S]*?)<\/section>/i) ||
            pageHtml.match(/<pre[^>]+class=["'][^"']*js-tab-content[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i);
          if (match) content = match[1];
        }

        // Clean up
        content = content
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/<[^>]*>/g, "");

        if (!content) throw new Error("Could not parse content");

        return new Response(JSON.stringify({ content: content, source: targetUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error("Invalid command");

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
