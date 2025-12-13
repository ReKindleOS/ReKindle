export default {
  async fetch(request, env) {
    // SECURITY: Only allow your specific domain
    // SECURITY: Limit to specific domains
    const ALLOWED_ORIGINS = [
      "https://beta.rekindle.pages.dev",
      "https://rekindle.ink",
      "https://lite.rekindle.ink",
      "https://legacy.rekindle.ink"
    ];

    const origin = request.headers.get("Origin");
    const isAllowed = ALLOWED_ORIGINS.includes(origin);

    const corsHeaders = {
      "Access-Control-Allow-Origin": isAllowed ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const { prompt } = await request.json();

      if (!prompt) {
        return new Response(JSON.stringify({ error: { message: "No prompt provided" } }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }

      // Configuration
      const API_KEY = env.GEMINI_API_KEY;

      // Using Gemini 2.5 Flash
      const MODEL = "gemini-2.5-flash";

      const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

      // Call Google Gemini
      const geminiResponse = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const data = await geminiResponse.json();

      // Extract text
      let responseText = "";
      if (data.candidates && data.candidates[0].content) {
        responseText = data.candidates[0].content.parts[0].text;
      } else if (data.error) {
        // Pass specific Google error back to frontend
        throw new Error(data.error.message);
      }

      return new Response(JSON.stringify({ text: responseText }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: { message: error.message } }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        },
      });
    }
  },
};