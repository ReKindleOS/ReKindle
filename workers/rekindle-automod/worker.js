// ReKindle Automod Worker
// Runs every 30 minutes, reviews the last hour of public content via Cloudflare Workers AI,
// and executes timeouts or bans matching the same logic as timeout_user.js / nuke_user.js.
//
// Strike system: each automod timeout records a strike under /automod_strikes/{uid}.
// Once a user hits STRIKE_LIMIT within STRIKE_WINDOW_DAYS, they are automatically
// escalated to a full nuke (auth disabled, IP banned, all content deleted).
// AI-recommended nukes for single severe incidents skip the strike system entirely.

const RTDB_BASE = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com';
const FIREBASE_PROJECT = 'rekindle-dd1fa';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY_API = `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT}`;

// ─── Testing Mode ─────────────────────────────────────────────────────────────
// Set to true to log all decisions without executing any actions.
// The AI still runs and the automod_log is still written, so you can review
// what it would have done. Flip to false when you're happy with it.
const DRY_RUN = false;

// ─── Strike Config ────────────────────────────────────────────────────────────
// Reach STRIKE_LIMIT strikes within STRIKE_WINDOW_DAYS → auto full-nuke
const STRIKE_LIMIT = 3;
const STRIKE_WINDOW_DAYS = 30;

// ─── Dedup Config ─────────────────────────────────────────────────────────────
// Prevents acting on the same user twice within the overlap window.
// Should match the cron interval (30 min) so overlapping runs don't double-punish.
const ACTION_COOLDOWN_MS = 11 * 60 * 1000;

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a content moderator for ReKindle, a cosy book-themed social network for readers worldwide. Your job is to identify clear community standard violations.

VIOLATION LEVELS:
- nuke (permanent ban): hate speech, slurs targeting protected groups, doxxing, explicit sexual content, credible threats of violence against others, severe targeted harassment campaigns
- timeout (temporary ban): extremely excessive spam/flooding in KindleChat only (10+ near-identical messages in a short window), personal insults, unsolicited advertising
  - 1 hour: mild one-off incidents (default — prefer this)
  - 2-4 hours: moderate incidents
  - 12-24 hours: serious or repeated incidents (use sparingly)

RULES:
- Be VERY CONSERVATIVE. The bar for any action is high — when in doubt, do nothing.
- Nothing minor is ever a reason for a timeout. Minor rudeness, snark, passive-aggression, heated arguments, and one-off insults are NOT violations.
- Posting multiple comments in a topic is completely normal behaviour — never flag this.
- Spam is only actionable in KindleChat, and only if it is extremely excessive (10+ near-identical messages in a short window). Spam anywhere else is never a reason for action.
- Self-harm or distress signals are NOT ban reasons — ignore them entirely.
- The user "ukiyo" is the site admin — never flag them under any circumstances.
- Only act on content in the messages provided, not on usernames alone.
- If you are unsure whether something crosses the line, it does not cross the line.

Respond with ONLY a valid JSON object and absolutely nothing else:
{
  "actions": [
    { "type": "nuke", "username": "exactusername", "reason": "brief reason" },
    { "type": "timeout", "username": "exactusername", "hours": 24, "reason": "brief reason" }
  ],
  "summary": "one sentence summary of what was found"
}
If no violations: { "actions": [], "summary": "No violations found." }`;

// ─── Entry Points ─────────────────────────────────────────────────────────────

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runAutomod(env));
    },

    async fetch(request, env, ctx) {
        const path = new URL(request.url).pathname;

        if (request.method === 'POST' && path === '/trigger') {
            ctx.waitUntil(runAutomod(env));
            return new Response('Automod run triggered.', { status: 200 });
        }

        // Debug endpoint — tests both tokens and raw RTDB responses
        if (path === '/debug') {
            const out = {};
            try {
                const idToken = await getFirebaseIdToken(env);
                out.idTokenOk = true;
                out.idTokenPrefix = idToken.substring(0, 20) + '...';

                // Test 1: public path with Firebase ID token
                const r1 = await fetch(`${RTDB_BASE}/kindlechat/messages.json?limitToLast=2&orderBy=%22%24key%22&auth=${idToken}`);
                out.chatWithIdToken = { status: r1.status, body: (await r1.text()).substring(0, 300) };

                // Test 2: auth-required path with Firebase ID token
                const r2 = await fetch(`${RTDB_BASE}/neighbourhood_posts.json?limitToLast=1&orderBy=%22%24key%22&auth=${idToken}`);
                out.neighbourhoodWithIdToken = { status: r2.status, body: (await r2.text()).substring(0, 300) };

                // Test 3: write-protected path (social_timeouts) — read only
                const r3 = await fetch(`${RTDB_BASE}/social_timeouts.json?shallow=true&auth=${idToken}`);
                out.timeoutsRead = { status: r3.status, body: (await r3.text()).substring(0, 200) };
            } catch (e) {
                out.idTokenOk = false;
                out.error = e.message;
            }
            return new Response(JSON.stringify(out, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('ReKindle Automod Worker — OK', { status: 200 });
    }
};

// ─── Main Run ─────────────────────────────────────────────────────────────────

async function runAutomod(env) {
    const startedAt = Date.now();
    const cutoff = startedAt - 60 * 60 * 1000; // last 1 hour
    console.log('[Automod] Starting at', new Date(startedAt).toISOString());

    let idToken, oauth2Token;
    try {
        [idToken, oauth2Token] = await Promise.all([getFirebaseIdToken(env), getGoogleOAuth2Token(env)]);
    } catch (e) {
        console.error('[Automod] Firebase auth failed:', e.message);
        return;
    }

    // Gather content from all four sources
    const { lines, uidMap } = await gatherContent(idToken, cutoff);

    if (lines.length === 0) {
        console.log('[Automod] No content in the last hour.');
        return;
    }

    const report = lines.join('\n');
    console.log(`[Automod] Report: ${lines.length} lines, ${report.length} chars`);

    // Ask AI to moderate
    const aiResult = await callAI(env, report);
    if (!aiResult) {
        console.error('[Automod] AI returned no usable result.');
        await writeLog(token, { ts: startedAt, error: 'ai_failed', actions: [] });
        return;
    }

    console.log('[Automod] AI summary:', aiResult.summary);
    console.log('[Automod] Actions recommended:', JSON.stringify(aiResult.actions));

    // Execute each action
    const results = [];
    for (const action of (aiResult.actions || [])) {
        if (!action.username || action.username.toLowerCase() === 'ukiyo') continue;
        const res = await applyAction(idToken, oauth2Token, action, uidMap);
        results.push(res);
    }

    await writeLog(idToken, { ts: startedAt, dryRun: DRY_RUN, summary: aiResult.summary, actions: results });
    console.log(`[Automod] Finished in ${Date.now() - startedAt}ms`);
}

// ─── Firebase Tokens ──────────────────────────────────────────────────────────
// Two tokens are needed:
//   idToken      — Firebase ID token for all RTDB operations (?auth=)
//   oauth2Token  — Google OAuth2 token for Identity Toolkit (disabling auth accounts)

const FIREBASE_WEB_API_KEY = 'AIzaSyDY7x7vVmlYUyVZNLuCCmIQYa6PWFVfZqQ';

// Signs a JWT with the service account private key
async function signJwt(env, payload) {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const pemBody = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const keyBuf = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0)).buffer;
    const key = await crypto.subtle.importKey(
        'pkcs8', keyBuf, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${body}`));
    return `${header}.${body}.${b64urlBin(sig)}`;
}

// Firebase custom token → ID token exchange
// Sets claims.email = ukiyo so RTDB rules treat this as the admin account
async function getFirebaseIdToken(env) {
    const now = Math.floor(Date.now() / 1000);
    const customToken = await signJwt(env, {
        iss: env.FIREBASE_CLIENT_EMAIL,
        sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        uid: 'automod-worker',
        iat: now,
        exp: now + 3600,
        claims: { email: 'ukiyo@rekindle.ink' }
    });

    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Referer': 'https://rekindle.ink' },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        }
    );
    const json = await res.json();
    if (!json.idToken) throw new Error('Firebase ID token exchange failed: ' + JSON.stringify(json));
    return json.idToken;
}

// Google OAuth2 access token — only used for Identity Toolkit (disabling Auth accounts)
async function getGoogleOAuth2Token(env) {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(env, {
        iss: env.FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/identitytoolkit',
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600
    });

    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const json = await res.json();
    if (!json.access_token) throw new Error('OAuth2 token exchange failed: ' + JSON.stringify(json));
    return json.access_token;
}

// base64url encode a JSON-safe string
function b64url(str) {
    return btoa(unescape(encodeURIComponent(str)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// base64url encode raw binary (ArrayBuffer)
function b64urlBin(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── RTDB REST Helpers ────────────────────────────────────────────────────────

// RTDB uses Firebase ID token via ?auth= (not Google OAuth2)
function rtdbUrl(idToken, path, params = '') {
    const base = `${RTDB_BASE}/${path}.json?auth=${idToken}`;
    return params ? `${base}&${params}` : base;
}

async function rtdbGet(token, path, params = '') {
    const res = await fetch(rtdbUrl(token, path, params));
    return res.json();
}

async function rtdbPut(token, path, data) {
    await fetch(rtdbUrl(token, path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

async function rtdbPost(token, path, data) {
    await fetch(rtdbUrl(token, path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

async function rtdbDelete(token, path) {
    await fetch(rtdbUrl(token, path), { method: 'DELETE' });
}

// ─── Content Gathering ────────────────────────────────────────────────────────

async function gatherContent(token, cutoff) {
    const lines = [];
    // username (lowercase) -> { uid, displayName }
    // populated as we encounter users so we can skip UID lookups at action time
    const uidMap = {};

    function register(displayName, uid) {
        if (displayName) uidMap[displayName.toLowerCase()] = { uid: uid || null, displayName };
    }

    // ── KindleChat ───────────────────────────────────────────────────────────
    // Messages stored at /kindlechat/messages, fields: user (username), text, timestamp
    try {
        const data = await rtdbGet(token, 'kindlechat/messages', 'orderBy=%22%24key%22&limitToLast=300');
        if (data && typeof data === 'object') {
            const all = Object.values(data);
            const msgs = all
                .filter(m => m && m.timestamp >= cutoff)
                .sort((a, b) => a.timestamp - b.timestamp);
            console.log('[Automod DEBUG] KindleChat msgs in window:', msgs.length);
            if (msgs.length) {
                lines.push('--- KindleChat ---');
                msgs.forEach(m => {
                    const u = m.user || '?';
                    register(u, null); // UID unknown for chat messages; resolved later if needed
                    lines.push(`${u}: ${(m.text || '').substring(0, 300)}`);
                });
                lines.push('');
            }
        }
    } catch (e) { console.warn('[Automod] KindleChat error:', e.message); }

    // ── Neighbourhood Posts ───────────────────────────────────────────────────
    // Posts at /neighbourhood_posts, fields: uid, text, timestamp, comments (nested)
    try {
        const data = await rtdbGet(token, 'neighbourhood_posts', 'orderBy=%22%24key%22&limitToLast=150');
        if (data && typeof data === 'object') {
            const posts = Object.values(data)
                .filter(p => p && p.timestamp >= cutoff && p.uid)
                .sort((a, b) => a.timestamp - b.timestamp);

            if (posts.length) {
                // Collect all unique UIDs to resolve in parallel
                const uidsNeeded = new Set();
                posts.forEach(p => {
                    uidsNeeded.add(p.uid);
                    if (p.comments) Object.values(p.comments).forEach(c => c?.uid && uidsNeeded.add(c.uid));
                });

                const nameFor = {};
                await Promise.all([...uidsNeeded].map(async uid => {
                    try {
                        const u = await rtdbGet(token, `users_public/${uid}`);
                        const name = (u && (u.displayName || (u.email || '').split('@')[0])) || uid.substring(0, 8);
                        nameFor[uid] = name;
                        register(name, uid);
                    } catch { nameFor[uid] = uid.substring(0, 8); }
                }));

                lines.push('--- Neighbourhood ---');
                posts.forEach(p => {
                    const name = nameFor[p.uid] || p.uid.substring(0, 8);
                    lines.push(`${name}: ${(p.text || '').substring(0, 300)}`);
                    if (p.comments) {
                        Object.values(p.comments)
                            .filter(c => c && c.timestamp >= cutoff)
                            .sort((a, b) => a.timestamp - b.timestamp)
                            .forEach(c => {
                                const cn = nameFor[c.uid] || c.uid?.substring(0, 8) || '?';
                                lines.push(`  ${cn} (reply): ${(c.text || '').substring(0, 300)}`);
                            });
                    }
                });
                lines.push('');
            }
        }
    } catch (e) { console.warn('[Automod] Neighbourhood error:', e.message); }

    // ── Topics ────────────────────────────────────────────────────────────────
    // Topics at /topics, fields: authorName, authorId, title, body, lastActive
    // Comments at /topic_comments/{topicId}, fields: authorName, authorId, body, timestamp
    try {
        const data = await rtdbGet(token, 'topics', `orderBy=%22lastActive%22&startAt=${cutoff}&limitToLast=50`);
        if (data && typeof data === 'object') {
            const entries = Object.entries(data)
                .filter(([, t]) => t && t.lastActive >= cutoff);

            if (entries.length) {
                lines.push('--- Topics ---');
                for (const [topicId, t] of entries) {
                    if (t.authorName) register(t.authorName, t.authorId || null);

                    // Only show the topic body if it was just posted in this window
                    if (t.timestamp >= cutoff) {
                        lines.push(`TOPIC by ${t.authorName || '?'}: "${(t.title || '').substring(0, 80)}" — ${(t.body || '').substring(0, 200)}`);
                    } else {
                        lines.push(`TOPIC (existing, new comments): "${(t.title || '').substring(0, 80)}"`);
                    }

                    // Fetch recent comments for this topic
                    try {
                        const cData = await rtdbGet(token, `topic_comments/${topicId}`, 'orderBy=%22%24key%22&limitToLast=50');
                        if (cData && typeof cData === 'object') {
                            Object.values(cData)
                                .filter(c => c && c.timestamp >= cutoff)
                                .sort((a, b) => a.timestamp - b.timestamp)
                                .forEach(c => {
                                    if (c.authorName) register(c.authorName, c.authorId || null);
                                    lines.push(`  Comment by ${c.authorName || '?'}: ${(c.body || '').substring(0, 300)}`);
                                });
                        }
                    } catch { /* topic may have no comments */ }
                }
                lines.push('');
            }
        }
    } catch (e) { console.warn('[Automod] Topics error:', e.message); }

    return { lines, uidMap };
}

// ─── AI Moderation ────────────────────────────────────────────────────────────

async function callAI(env, report) {
    // Truncate to stay within Workers AI context limits
    const maxChars = 5500;
    const input = report.length > maxChars
        ? report.substring(0, maxChars) + '\n[...truncated for length]'
        : report;

    try {
        const res = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Review these messages from the last hour:\n\n${input}` }
            ],
            max_tokens: 600,
            temperature: 0.1
        });

        const raw = (res.response || '').trim();
        console.log('[Automod] Raw AI response:', raw.substring(0, 400));

        // Extract first JSON object from response
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) {
            console.error('[Automod] No JSON found in AI response');
            return null;
        }

        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed.actions)) parsed.actions = [];
        return parsed;
    } catch (e) {
        console.error('[Automod] AI error:', e.message);
        return null;
    }
}

// ─── Action Execution ─────────────────────────────────────────────────────────

async function applyAction(idToken, oauth2Token, action, uidMap) {
    const { type, username, hours, reason } = action;
    const result = { type, username, reason: (reason || '').substring(0, 200), status: 'pending' };

    // Resolve UID — use gathered map first, fall back to full scan
    let entry = uidMap[username.toLowerCase()];
    let uid = entry?.uid || null;

    if (!uid) {
        console.log(`[Automod] UID not in map for "${username}", scanning users_public...`);
        uid = await lookupUid(idToken, username);
    }

    if (!uid) {
        console.warn(`[Automod] Could not resolve UID for "${username}" — skipping`);
        result.status = 'not_found';
        return result;
    }

    result.uid = uid;

    // Dedup: skip if we already acted on this user within the cooldown window
    const lastAction = await rtdbGet(idToken, `automod_last_action/${uid}`);
    if (lastAction && typeof lastAction === 'number' && Date.now() - lastAction < ACTION_COOLDOWN_MS) {
        console.log(`[Automod] Skipping ${username} — acted ${Math.round((Date.now() - lastAction) / 60000)}min ago (within cooldown)`);
        result.status = 'skipped_cooldown';
        return result;
    }

    try {
        if (type === 'nuke') {
            if (DRY_RUN) {
                result.status = 'dry_run_would_nuke_immediate';
                console.log(`[Automod DRY RUN] Would immediately nuke+IP ban: ${username} (${uid}) — ${reason}`);
            } else {
                await doFullNuke(idToken, oauth2Token, uid, username, reason || 'Automod: severe policy violation', true);
                result.status = 'nuked_immediate';
            }
        } else {
            const h = Math.max(1, Math.min(hours || 24, 168));
            if (DRY_RUN) {
                result.status = `dry_run_would_timeout_${h}h`;
                console.log(`[Automod DRY RUN] Would timeout ${h}h + record strike: ${username} (${uid}) — ${reason}`);
            } else {
                const escalated = await doTimeoutWithStrike(idToken, oauth2Token, uid, username, h, reason || 'Automod');
                result.status = escalated ? 'nuked_escalated' : `timed_out_${h}h`;
            }
        }
        console.log(`[Automod] ${result.status}: ${username} (${uid}) — ${reason}`);
        // Record timestamp so next overlapping run skips this user
        await rtdbPut(idToken, `automod_last_action/${uid}`, Date.now());
    } catch (e) {
        console.error(`[Automod] Action failed for ${username}:`, e.message);
        result.status = 'error';
        result.error = e.message;
    }

    return result;
}

// Scan users_public to find a UID matching a username/email handle
async function lookupUid(token, username) {
    const uidIndex = await rtdbGet(token, 'users_public', 'shallow=true');
    if (!uidIndex) return null;

    const target = username.toLowerCase();
    for (const uid of Object.keys(uidIndex)) {
        try {
            const u = await rtdbGet(token, `users_public/${uid}`);
            if (!u) continue;
            const name = (u.displayName || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            if (name === target || email === target || email.startsWith(target + '@')) return uid;
        } catch { /* skip */ }
    }
    return null;
}

// ── Timeout + Strike system ───────────────────────────────────────────────────
// Returns true if the strike threshold was hit and a full nuke was executed.

async function doTimeoutWithStrike(idToken, oauth2Token, uid, username, hours, reason) {
    // Apply the timeout first (same as timeout_user.js)
    const existing = await rtdbGet(idToken, `social_timeouts/${uid}`);
    if (existing && typeof existing.durationHours === 'number' && existing.durationHours >= hours) {
        console.log(`[Automod] ${uid} already has ${existing.durationHours}h timeout — not shortening`);
    } else {
        await rtdbPut(idToken, `social_timeouts/${uid}`, {
            reason: `[Automod] ${reason}`,
            durationHours: hours
        });
        await rtdbDelete(idToken, `users_private/${uid}/timeout_seen`);
    }

    // Record a strike
    const strikeWindowMs = STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const cutoff = now - strikeWindowMs;

    let strikeData = await rtdbGet(idToken, `automod_strikes/${uid}`) || { strikes: [] };
    if (!Array.isArray(strikeData.strikes)) strikeData.strikes = [];

    strikeData.strikes.push({ ts: now, reason, hours });
    const recentStrikes = strikeData.strikes.filter(s => s.ts >= cutoff);
    strikeData.strikes = recentStrikes;
    strikeData.count = recentStrikes.length;
    strikeData.lastStrikeAt = now;
    if (!strikeData.firstStrikeAt || strikeData.firstStrikeAt < cutoff) {
        strikeData.firstStrikeAt = recentStrikes[0]?.ts || now;
    }

    await rtdbPut(idToken, `automod_strikes/${uid}`, strikeData);
    console.log(`[Automod] Strike recorded for ${uid}: ${strikeData.count}/${STRIKE_LIMIT} in the last ${STRIKE_WINDOW_DAYS} days`);

    if (strikeData.count >= STRIKE_LIMIT) {
        console.log(`[Automod] Strike limit reached for ${uid} — escalating to full nuke (no IP ban)`);
        await doFullNuke(idToken, oauth2Token, uid, username, `Strike limit reached (${strikeData.count} violations in ${STRIKE_WINDOW_DAYS} days)`, false);
        return true;
    }

    return false;
}

// ── Full Nuke — mirrors nuke_user.js --force ──────────────────────────────────
// ipBan=true only for single heinous incidents. Strike escalations skip IP ban.
async function doFullNuke(idToken, oauth2Token, uid, username, reason, ipBan = false) {
    console.log(`[Automod] Executing full nuke on ${uid} (${username}), IP ban: ${ipBan}`);

    // 1. Permanent social timeout
    await rtdbPut(idToken, `social_timeouts/${uid}`, {
        reason: `[Automod] ${reason}`,
        durationHours: 999999
    });
    await rtdbDelete(idToken, `users_private/${uid}/timeout_seen`);

    // 2. IP ban — only for egregious single-incident cases
    if (ipBan) {
        try {
            const ip = await rtdbGet(idToken, `users_private/${uid}/ipAddress`);
            if (ip && typeof ip === 'string') {
                const key = ip.replace(/\./g, '-').replace(/:/g, '_');
                await rtdbPut(idToken, `banned_ips/${key}`, {
                    timestamp: Date.now(),
                    bannedBy: 'automod',
                    bannedUid: uid,
                    reason: `[Automod] ${reason}`
                });
                console.log(`[Automod] IP banned: ${ip}`);
            }
        } catch (e) { console.warn('[Automod] IP ban skipped:', e.message); }
    }

    // 3. Disable Firebase Auth account (uses Google OAuth2 token, not ID token)
    try {
        const res = await fetch(`${IDENTITY_API}/accounts:update`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${oauth2Token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ localId: uid, disableUser: true })
        });
        const data = await res.json();
        if (data.error) console.error('[Automod] Auth disable error:', data.error.message);
        else console.log(`[Automod] Firebase Auth disabled for ${uid}`);
    } catch (e) { console.error('[Automod] Auth disable failed:', e.message); }

    // 4. Delete content
    await deleteUserContent(idToken, uid, username);
}

// ── Content Deletion ──────────────────────────────────────────────────────────

async function deleteUserContent(idToken, uid, username) {
    const token = idToken;
    let deleted = 0;

    // KindleChat general messages (indexed by `user` = email handle / username)
    try {
        const msgs = await rtdbGet(token, 'kindlechat/messages',
            `orderBy=%22user%22&equalTo=${encodeURIComponent(JSON.stringify(username))}`);
        if (msgs && typeof msgs === 'object') {
            for (const key of Object.keys(msgs)) {
                await rtdbDelete(token, `kindlechat/messages/${key}`);
                deleted++;
            }
            console.log(`[Automod] Deleted ${Object.keys(msgs).length} KindleChat messages`);
        }
    } catch (e) { console.warn('[Automod] KindleChat deletion error:', e.message); }

    // Neighbourhood posts (indexed by `uid`)
    try {
        const posts = await rtdbGet(token, 'neighbourhood_posts',
            `orderBy=%22uid%22&equalTo=${encodeURIComponent(JSON.stringify(uid))}`);
        if (posts && typeof posts === 'object') {
            for (const key of Object.keys(posts)) {
                await rtdbDelete(token, `neighbourhood_posts/${key}`);
                deleted++;
            }
            console.log(`[Automod] Deleted ${Object.keys(posts).length} Neighbourhood posts`);
        }
    } catch (e) { console.warn('[Automod] Neighbourhood post deletion error:', e.message); }

    // Neighbourhood comments (nested under posts — must scan all posts)
    try {
        const allPosts = await rtdbGet(token, 'neighbourhood_posts', 'shallow=true');
        if (allPosts && typeof allPosts === 'object') {
            for (const postId of Object.keys(allPosts)) {
                try {
                    const post = await rtdbGet(token, `neighbourhood_posts/${postId}`);
                    if (post?.comments) {
                        for (const [cid, c] of Object.entries(post.comments)) {
                            if (c?.uid === uid) {
                                await rtdbDelete(token, `neighbourhood_posts/${postId}/comments/${cid}`);
                                deleted++;
                            }
                        }
                    }
                } catch { /* skip */ }
            }
        }
    } catch (e) { console.warn('[Automod] Neighbourhood comment deletion error:', e.message); }

    // Topics (indexed by `authorId`)
    try {
        const topics = await rtdbGet(token, 'topics',
            `orderBy=%22authorId%22&equalTo=${encodeURIComponent(JSON.stringify(uid))}`);
        if (topics && typeof topics === 'object') {
            for (const key of Object.keys(topics)) {
                await rtdbDelete(token, `topics/${key}`);
                // Also delete associated comments
                await rtdbDelete(token, `topic_comments/${key}`);
                deleted++;
            }
            console.log(`[Automod] Deleted ${Object.keys(topics).length} Topics`);
        }
    } catch (e) { console.warn('[Automod] Topic deletion error:', e.message); }

    // Topic comments (must scan all topics for comments by this user)
    try {
        const topicIndex = await rtdbGet(token, 'topic_comments', 'shallow=true');
        if (topicIndex && typeof topicIndex === 'object') {
            for (const topicId of Object.keys(topicIndex)) {
                try {
                    const comments = await rtdbGet(token, `topic_comments/${topicId}`);
                    if (comments && typeof comments === 'object') {
                        for (const [cid, c] of Object.entries(comments)) {
                            if (c?.authorId === uid) {
                                await rtdbDelete(token, `topic_comments/${topicId}/${cid}`);
                                deleted++;
                            }
                        }
                    }
                } catch { /* skip */ }
            }
        }
    } catch (e) { console.warn('[Automod] Topic comment deletion error:', e.message); }

    console.log(`[Automod] Content deletion complete — ${deleted} items removed for ${uid}`);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function writeLog(token, entry) {
    try {
        await rtdbPost(token, 'automod_log', entry);
    } catch (e) { console.warn('[Automod] Log write failed:', e.message); }
}
