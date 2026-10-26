/*
 * ReKindle Oracle — multi-provider AI proxy.
 *
 * Security (2026-10-26): the worker used to accept anonymous prompts. Every
 * request must now carry a Firebase ID token, belong to a ReKindle+ member, and
 * (when using the built-in key) stay inside the daily quota. The quota is
 * mirrored in Firestore so it survives worker restarts; the client-side copy
 * remains only as an optimistic display.
 */

const ALLOWED_ORIGINS = [
  "https://beta.rekindle.ink",
  "https://rekindle.ink",
  "https://lite.rekindle.ink",
  "https://legacy.rekindle.ink"
];
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

const PROJECT_ID = "rekindle-dd1fa";
const DAILY_LIMIT = 10;
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwksCache = { keys: null, expires: 0 };

function base64UrlBytes(value) {
  let pad = value.length % 4;
  if (pad) value += new Array(5 - pad).join("=");
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));
}

async function getJwks(force) {
  const now = Date.now();
  if (!force && jwksCache.keys && now < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) return null;
  const data = await res.json();
  jwksCache = { keys: data.keys || [], expires: now + 60 * 60 * 1000 };
  return jwksCache.keys;
}

async function verifyFirebaseUser(request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch (e) {
    return null;
  }

  if (!header || header.alg !== "RS256") return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT_ID) return null;
  if (payload.iss !== "https://securetoken.google.com/" + PROJECT_ID) return null;
  if (!payload.sub || typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (payload.iat && payload.iat > now + 300) return null;

  try {
    let keys = await getJwks(false);
    let jwk = keys && keys.find(k => k.kid === header.kid);
    if (!jwk) {
      keys = await getJwks(true);
      jwk = keys && keys.find(k => k.kid === header.kid);
    }
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!valid) return null;
    return { uid: payload.sub, email: payload.email || "", token: token };
  } catch (e) {
    return null;
  }
}

async function readProStatus(user) {
  const url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
    "/databases/(default)/documents/users/" + encodeURIComponent(user.uid);
  try {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + user.token } });
    if (!res.ok) return false;
    const data = await res.json();
    const fields = data.fields || {};
    const expiry = fields.proExpiresAt && fields.proExpiresAt.timestampValue
      ? Date.parse(fields.proExpiresAt.timestampValue)
      : 0;
    return expiry > Date.now();
  } catch (e) {
    return false;
  }
}

function quotaPath(user) {
  const day = new Date().toISOString().slice(0, 10);
  return "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
    "/databases/(default)/documents/users/" + encodeURIComponent(user.uid) +
    "/chatLimits/" + day;
}

async function readQuota(user) {
  try {
    const res = await fetch(quotaPath(user), {
      headers: { Authorization: "Bearer " + user.token }
    });
    if (res.status === 404) return 0;
    if (!res.ok) return 0;
    const data = await res.json();
    const count = data.fields && data.fields.count && data.fields.count.integerValue;
    return count ? parseInt(count, 10) || 0 : 0;
  } catch (e) {
    return 0;
  }
}

async function writeQuota(user, count) {
  const body = {
    fields: {
      count: { integerValue: String(count) },
      lastUpdated: { timestampValue: new Date().toISOString() }
    }
  };
  try {
    await fetch(quotaPath(user) + "?updateMask.fieldPaths=count&updateMask.fieldPaths=lastUpdated", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + user.token
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    // Quota persistence is best-effort; the request already passed the check.
  }
}

function cleanMessages(messages, prompt) {
  const out = [];
  if (Array.isArray(messages)) {
    for (const m of messages.slice(-12)) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      const content = String(m.content || "").slice(0, 4000);
      if (content.trim()) out.push({ role: m.role, content: content });
    }
  }
  if (out.length === 0 && prompt) out.push({ role: "user", content: String(prompt).slice(0, 8000) });
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    try {
      const body = await request.json();
      const { prompt, apiKey, provider, model, action } = body;

      // --- AUTH + ENTITLEMENT ---
      const user = await verifyFirebaseUser(request);
      if (!user) {
        return json({ error: { message: "Please sign in to use the AI Assistant." } }, 401, cors);
      }
      const pro = await readProStatus(user);
      if (!pro) {
        return json({ error: { message: "ReKindle+ is required for the AI Assistant." } }, 403, cors);
      }

      const messages = cleanMessages(body.messages, prompt);
      if (messages.length === 0 && action !== "list_models") {
        return json({ error: { message: "No prompt provided" } }, 400, cors);
      }

      // Built-in-key requests count against the daily limit. A user's own key
      // is their cost, so it is not metered here.
      if (!apiKey && action !== "list_models") {
        const used = await readQuota(user);
        if (used >= DAILY_LIMIT) {
          return json({
            error: {
              message: "You have reached today's " + DAILY_LIMIT + "-message limit. Try again tomorrow or use your own API key."
            }
          }, 429, cors);
        }
        await writeQuota(user, used + 1);
      }

      // --- ACTION: LIST MODELS ---
      if (action === "list_models") {
        let models = [];

        if (provider === "openai") {
          if (!apiKey) throw new Error("OpenAI API Key required.");
          const resp = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          const data = await resp.json();
          if (data.error) throw new Error(data.error.message);
          models = (data.data || [])
            .filter(m => m.id.startsWith("gpt") || m.id.startsWith("o1"))
            .map(m => ({ id: m.id, name: m.id }));
        } else {
          const key = apiKey || env.GEMINI_API_KEY;
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
          const data = await resp.json();
          if (data.error) throw new Error(data.error.message);
          models = (data.models || [])
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
            .map(m => ({ id: m.name.replace("models/", ""), name: m.displayName || m.name.replace("models/", "") }));
        }

        return json({ models: models }, 200, cors);
      }

      let responseText = "";

      // --- OPENAI HANDLER ---
      if (provider === "openai") {
        if (!apiKey) throw new Error("OpenAI API Key required.");
        const isO1 = (model || "").startsWith("o1-");
        const requestBody = {
          model: model || "gpt-4o-mini",
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        };
        if (isO1) {
          requestBody.max_completion_tokens = 2000;
        } else {
          requestBody.max_tokens = 800;
        }

        const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        });
        const data = await openAiResponse.json();
        if (data.error) throw new Error(data.error.message);
        if (data.choices && data.choices[0] && data.choices[0].message) {
          responseText = data.choices[0].message.content;
        }
      } else {
        // --- GEMINI HANDLER ---
        const key = apiKey || env.GEMINI_API_KEY;
        const chosenModel = model || "gemini-2.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${key}`;
        const contents = messages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));

        const geminiResponse = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: contents })
        });
        const data = await geminiResponse.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          responseText = data.candidates[0].content.parts[0].text;
        } else if (data.error) {
          throw new Error(data.error.message);
        }
      }

      return json({ text: responseText }, 200, cors);
    } catch (error) {
      return json({ error: { message: error.message } }, 500, cors);
    }
  }
};
