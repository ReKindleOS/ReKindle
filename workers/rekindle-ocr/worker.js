export default {
  async fetch(request, env) {
    // SECURITY: Only allow your specific domain
    const ALLOWED_ORIGIN = "https://rekindle.ink";
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Send a POST request with JSON body { image: 'base64...' }", { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // 2. Parse Image
      const body = await request.json();
      const base64Image = body.image;

      if (!base64Image) {
        return new Response(JSON.stringify({ error: "No image provided" }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // 3. Convert Base64 to Array
      const binaryString = atob(base64Image);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const imageArray = [...bytes];

      // 4. Run AI Model
      const response = await env.AI.run(
        "@cf/meta/llama-3.2-11b-vision-instruct",
        {
          // Sentinel Token Strategy
          prompt: `You are a strict Optical Character Recognition (OCR) machine. 
Your ONLY job is to output the handwritten text found in the image.

RULES:
1. Output ONLY the raw text.
2. Do NOT use markdown code blocks.
3. Do NOT add conversational filler or explanations.
4. If the image is blank, blurry, or contains no text, output EXACTLY this string: "__NO_TEXT_DETECTED__"
5. Do NOT explain why you are outputting "__NO_TEXT_DETECTED__".`,
          image: imageArray,
          temperature: 0, 
          max_tokens: 60,
        }
      );

      // 5. Clean/Sanitize Output
      let rawText = response.response || "";

      // Cleanup Markdown
      rawText = rawText.replace(/```[\s\S]*?\n/g, "").replace(/```/g, "");
      
      // Cleanup prefixes
      const prefixesToRemove = ["Here is the text:", "The text is:", "Output:"];
      prefixesToRemove.forEach(prefix => {
        if (rawText.toLowerCase().startsWith(prefix.toLowerCase())) {
          rawText = rawText.substring(prefix.length);
        }
      });

      let cleanedText = rawText.trim();

      // Remove Trailing Period
      if (cleanedText.endsWith(".")) {
        cleanedText = cleanedText.slice(0, -1);
      }

      // --- Safety Filters ---

      // Check for the Sentinel Token
      if (cleanedText.includes("__NO_TEXT_DETECTED__")) {
        cleanedText = "";
      }

      // "Hallucination Filter"
      const hallucinationPatterns = [
        /^The image (is|appears|seems) (blank|empty|unreadable)/i,
        /^There is no (text|handwriting)/i,
        /^I cannot read/i,
        /output a single space/i
      ];

      if (hallucinationPatterns.some(pattern => pattern.test(cleanedText))) {
        cleanedText = "";
      }

      // 6. Return Text
      return new Response(JSON.stringify({ text: cleanedText }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  },
};