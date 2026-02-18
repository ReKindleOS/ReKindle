
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval") || "60m";
  const range = url.searchParams.get("range") || "1d";

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Symbol required" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  // Yahoo Finance API URL
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;

  try {
    const response = await fetch(yahooUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
      },
    });

    if (!response.ok) {
        // Try query2 as backup
        const yahooUrl2 = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
        const response2 = await fetch(yahooUrl2, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
            },
        });
        
        if (!response2.ok) {
             return new Response(JSON.stringify({ error: "Yahoo API Error", status: response2.status }), {
                headers: { "Content-Type": "application/json" },
                status: response2.status,
            });
        }
        
        const data = await response2.json();
        return new Response(JSON.stringify(data), {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", // Allow all for now
            },
        });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}
