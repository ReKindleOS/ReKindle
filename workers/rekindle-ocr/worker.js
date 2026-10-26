/*
 * ReKindle OCR — handwriting OCR for Quick ToDo / QuickNotes.
 *
 * Security (2026-10-26): anonymous requests are rejected. The caller must send
 * a Firebase ID token for a ReKindle+ member; entitlement is checked against
 * Firestore before the AI binding runs.
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
    return { uid: payload.sub, token: token };
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Send a POST request with JSON body { image: 'base64...' }", {
        status: 405,
        headers: cors
      });
    }

    try {
      const user = await verifyFirebaseUser(request);
      if (!user) {
        return json({ error: "Please sign in to use handwriting OCR." }, 401, cors);
      }
      const pro = await readProStatus(user);
      if (!pro) {
        return json({ error: "ReKindle+ is required for handwriting OCR." }, 403, cors);
      }

      const body = await request.json();
      const base64Image = body.image;

      if (!base64Image) {
        return json({ error: "No image provided" }, 400, cors);
      }

      const binaryString = atob(base64Image);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const imageArray = [...bytes];

      const response = await env.AI.run(
        "@cf/meta/llama-3.2-11b-vision-instruct",
        {
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
          max_tokens: 60
        }
      );

      let rawText = response.response || "";
      rawText = rawText.replace(/```[\s\S]*?\n/g, "").replace(/```/g, "");

      const prefixesToRemove = ["Here is the text:", "The text is:", "Output:"];
      prefixesToRemove.forEach(prefix => {
        if (rawText.toLowerCase().startsWith(prefix.toLowerCase())) {
          rawText = rawText.substring(prefix.length);
        }
      });

      let cleanedText = rawText.trim();
      if (cleanedText.endsWith(".")) {
        cleanedText = cleanedText.slice(0, -1);
      }

      if (cleanedText.includes("__NO_TEXT_DETECTED__")) {
        cleanedText = "";
      }

      const hallucinationPatterns = [
        /^The image (is|appears|seems) (blank|empty|unreadable)/i,
        /^There is no (text|handwriting)/i,
        /^I cannot read/i,
        /output a single space/i
      ];

      if (hallucinationPatterns.some(pattern => pattern.test(cleanedText))) {
        cleanedText = "";
      }

      return json({ text: cleanedText }, 200, cors);
    } catch (e) {
      return json({ error: e.message }, 500, cors);
    }
  }
};
