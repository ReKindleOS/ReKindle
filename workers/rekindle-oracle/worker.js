export default {
  async fetch(request, env) {
    // START: Common CORS and Security
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
      const { prompt, apiKey, provider, model, action } = await request.json(); // provider = 'gemini' | 'openai'

      if (!prompt && action !== 'list_models') {
        return new Response(JSON.stringify({ error: { message: "No prompt provided" } }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // --- ACTION: LIST MODELS ---
      if (action === 'list_models') {
        let models = [];

        // --- OPENAI LIST ---
        if (provider === 'openai') {
          if (!apiKey) throw new Error("OpenAI API Key required.");
          const resp = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` }
          });
          const data = await resp.json();
          if (data.error) throw new Error(data.error.message);

          // Filter and Map
          models = (data.data || [])
            .filter(m => m.id.startsWith("gpt") || m.id.startsWith("o1"))
            .map(m => ({ id: m.id, name: m.id }));
        }
        // --- GEMINI LIST ---
        else {
          const API_KEY = apiKey || env.GEMINI_API_KEY;
          // V1Beta models endpoint
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
          const data = await resp.json();
          if (data.error) throw new Error(data.error.message);

          models = (data.models || [])
            // Filter for generateContent support
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
            .map(m => ({
              id: m.name.replace("models/", ""),
              name: m.displayName || m.name.replace("models/", "")
            }));
        }

        return new Response(JSON.stringify({ models: models }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      let responseText = "";

      // --- OPENAI HANDLER ---
      if (provider === 'openai') {
        if (!apiKey) {
          throw new Error("OpenAI API Key required.");
        }

        const isO1 = (model || "").startsWith("o1-");
        const body = {
          model: model || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }]
        };

        if (isO1) {
          body.max_completion_tokens = 2000;
        } else {
          body.max_tokens = 500;
        }

        const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        });

        const data = await openAiResponse.json();

        if (data.error) throw new Error(data.error.message);
        if (data.choices && data.choices[0]) {
          responseText = data.choices[0].message.content;
        }

      }
      // --- GEMINI HANDLER (DEFAULT) ---
      else {
        // Configuration
        const API_KEY = apiKey || env.GEMINI_API_KEY;
        const MODEL = model || "gemini-2.5-flash";
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
        if (data.candidates && data.candidates[0].content) {
          responseText = data.candidates[0].content.parts[0].text;
        } else if (data.error) {
          throw new Error(data.error.message);
        }
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