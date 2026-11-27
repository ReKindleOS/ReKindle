/**
 * ReKindle beta access gate — template, not deployed from the source tree.
 *
 * `scripts/build-beta-gate.js` copies `_deploy/main` to `_deploy/beta`, injects
 * the passphrase hash and cookie secret below, adds `_routes.json`, and
 * `npm run deploy:beta` publishes that directory. Production therefore never
 * runs this middleware and never pays a Pages Function invocation for it.
 *
 * Why a gate instead of Cloudflare Access (2026-11-27):
 *   - Pages' preview Access policy protects `<hash>.rekindle.pages.dev` but
 *     explicitly NOT the branch alias `beta.rekindle.pages.dev` or a custom
 *     domain, so the public beta would still be reachable at the alias.
 *   - The Access login page is a modern JS app; the Kindle browser is Chromium
 *     75 / WebKit 534 and cannot be assumed to render it. This gate page is
 *     plain HTML/CSS with no JavaScript, so it works on the devices the beta
 *     exists to test.
 *   - The gate lives in the deployment, so it covers the custom domain, the
 *     branch alias and every preview hash for that deployment.
 *
 * The cookie is an HMAC of the expiry. Rotating BETA_GATE_PASSPHRASE and
 * redeploying invalidates every existing cookie because the signing secret is
 * derived from the passphrase.
 *
 * The two constants below are injected by scripts/build-beta-gate.js; this
 * source template contains no usable secret.
 */

const PASS_HASH = '__PASS_HASH__';
const COOKIE_SECRET = '__COOKIE_SECRET__';
const COOKIE_NAME = 'rk_beta';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days — typing on a Kindle is painful
const GATE_PATH = '/__beta_gate';
const MAX_BODY = 4096;
const FAIL_DELAY_MS = 400;

const encoder = new TextEncoder();

function toHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return out;
}

async function sha256(value) {
    return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(value) {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(COOKIE_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function readCookie(request, name) {
    const header = request.headers.get('cookie') || '';
    const parts = header.split(';');
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].replace(/^\s+|\s+$/g, '');
        const eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
    }
    return '';
}

async function hasValidCookie(request) {
    const raw = readCookie(request, COOKIE_NAME);
    if (!raw) return false;
    const dot = raw.indexOf('.');
    if (dot <= 0) return false;
    const exp = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);
    if (!/^[0-9]{1,12}$/.test(exp)) return false;
    if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
    return safeEqual(signature, await hmac('v1|' + exp));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeNext(value) {
    if (!value || value.charAt(0) !== '/') return '/';
    if (value.charAt(1) === '/' || value.charAt(1) === '\\') return '/';
    if (/[\\\r\n]/.test(value)) return '/';
    return value;
}

function looksLikeHtml(request, path) {
    const accept = (request.headers.get('accept') || '').toLowerCase();
    if (accept.indexOf('text/html') !== -1) return true;
    if (accept && accept.indexOf('*/*') === -1) return false;
    return !/\.[a-z0-9]{1,8}$/i.test(path);
}

function gatePage(next, failed) {
    const error = failed
        ? '<div class="err">Incorrect passphrase. Try again.</div>'
        : '';
    return '<!doctype html><html lang="en"><head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">' +
        '<meta name="robots" content="noindex, nofollow">' +
        '<title>ReKindle Beta</title>' +
        '<style>' +
        'html,body{margin:0;padding:0;background:#e5e5e5;color:#000;font-family:"Geneva","Verdana",sans-serif;}' +
        'body{padding:24px 12px;}' +
        '.box{max-width:420px;margin:0 auto;background:#fff;border:2px solid #000;box-shadow:4px 4px 0 #000;}' +
        '.bar{position:relative;height:35px;border-bottom:2px solid #000;background:#fff;text-align:center;}' +
        '.stripes{position:absolute;left:4px;right:4px;top:4px;bottom:4px;background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,#000 3px,#000 4px);}' +
        '.title{position:relative;display:inline-block;background:#fff;padding:0 15px;font-weight:bold;font-size:16px;line-height:35px;}' +
        '.body{padding:18px 18px 20px;}' +
        'p{font-size:14px;line-height:1.4;margin:0 0 14px;}' +
        'label{display:block;font-weight:bold;font-size:13px;margin:0 0 6px;}' +
        'input[type=password]{display:block;width:100%;box-sizing:border-box;border:2px solid #000;border-radius:0;background:#fff;color:#000;font-family:inherit;font-size:16px;line-height:20px;padding:12px;margin:0 0 14px;}' +
        'button{display:block;width:100%;border:2px solid #000;border-radius:0;background:#fff;color:#000;font-family:inherit;font-weight:bold;font-size:16px;line-height:20px;padding:12px;box-shadow:2px 2px 0 #000;cursor:pointer;}' +
        'button:active{transform:translate(2px,2px);box-shadow:none;background:#000;color:#fff;}' +
        '.err{border:2px solid #000;background:#000;color:#fff;padding:8px;font-size:13px;margin:0 0 14px;}' +
        '.note{font-size:11px;line-height:1.35;margin:14px 0 0;color:#333;}' +
        '</style></head><body>' +
        '<div class="box">' +
        '<div class="bar"><div class="stripes"></div><span class="title">ReKindle Beta</span></div>' +
        '<div class="body">' +
        '<p>This build is private.</p>' +
        error +
        '<form method="POST" action="' + GATE_PATH + '">' +
        '<input type="hidden" name="next" value="' + escapeHtml(next) + '">' +
        '<label for="beta-pass">Passphrase</label>' +
        '<input id="beta-pass" name="passphrase" type="password" autocomplete="current-password" required>' +
        '<button type="submit">Unlock</button>' +
        '</form>' +
        '<p class="note">Only the owner should have this passphrase. This device stays unlocked for 90 days.</p>' +
        '</div></div></body></html>';
}

function gateResponse(html, status) {
    return new Response(html, {
        status: status || 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'X-Robots-Tag': 'noindex, nofollow',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        }
    });
}

/**
 * A visitor who loaded the beta before the gate may still have the app in the
 * service-worker cache. The update check for /sw.js bypasses the old worker, so
 * serve a self-destructing worker when unauthenticated: it drops every beta
 * cache and unregisters itself. The normal sw.js is served once the cookie is
 * valid (the app re-registers it on load).
 */
const KILL_SW = "self.addEventListener('install',function(){self.skipWaiting();});" +
    "self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(k){" +
    "return Promise.all(k.map(function(n){return caches.delete(n);}));" +
    "}).then(function(){return self.registration.unregister();}));});";

function killSwResponse() {
    return new Response(KILL_SW, {
        status: 200,
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'X-Robots-Tag': 'noindex, nofollow'
        }
    });
}

export const onRequest = async (context) => {
    const request = context.request;
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === GATE_PATH && request.method === 'POST') {
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > MAX_BODY) {
            return new Response('Bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
        }
        const body = await request.text();
        if (body.length > MAX_BODY) {
            return new Response('Bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
        }
        const params = new URLSearchParams(body);
        const supplied = (params.get('passphrase') || '').replace(/^\s+|\s+$/g, '');
        const next = safeNext(params.get('next') || '/');
        const submitted = await sha256('rekindle-beta-pass-v1|' + supplied);
        if (safeEqual(submitted, PASS_HASH)) {
            const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
            const value = exp + '.' + (await hmac('v1|' + exp));
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': new URL(next, url).toString(),
                    'Set-Cookie': COOKIE_NAME + '=' + value + '; Path=/; Max-Age=' + COOKIE_MAX_AGE +
                        '; HttpOnly; Secure; SameSite=Lax',
                    'Cache-Control': 'no-store',
                    'X-Robots-Tag': 'noindex, nofollow'
                }
            });
        }
        await new Promise((resolve) => setTimeout(resolve, FAIL_DELAY_MS));
        return gateResponse(gatePage(next, true), 200);
    }

    if (path === GATE_PATH) {
        return gateResponse(gatePage(safeNext(url.searchParams.get('next') || '/'), false), 200);
    }

    // Cloudflare validates/renews the custom-domain certificate over this path.
    // It is a public token, not app content; blocking it would eventually break
    // HTTPS on beta.rekindle.ink. Cloudflare's own Access docs require the same
    // exemption.
    if (path.indexOf('/.well-known/acme-challenge/') === 0) {
        return context.next();
    }

    if (await hasValidCookie(request)) {
        return context.next();
    }

    if (path === '/sw.js') {
        return killSwResponse();
    }

    if (looksLikeHtml(request, path)) {
        return gateResponse(gatePage(path + url.search, false), 200);
    }

    return new Response('This ReKindle beta build is private. Open the site in a browser to unlock it.\n', {
        status: 401,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'X-Robots-Tag': 'noindex, nofollow'
        }
    });
};
