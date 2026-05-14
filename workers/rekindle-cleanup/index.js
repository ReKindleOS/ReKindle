const DB = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com';

const THREE_DAYS_MS  = 3  * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS  = 7  * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const STRIKE_LIMIT = 3; // must match rekindle-automod/worker.js

// ── Service account JWT auth ──────────────────────────────────────────────────

async function getAccessToken(serviceAccountJson) {
  const sa  = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const b64url = obj =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   sa.client_email,
    sub:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----\n?/, '')
    .replace(/\n?-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');

  const keyData   = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );

  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${signingInput}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

// ── Firebase REST helpers ─────────────────────────────────────────────────────

async function fbGet(path, token) {
  const res = await fetch(`${DB}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Firebase supports multi-path updates: keys like "topicId/commentId" are
// treated as paths, so one PATCH can touch many nested nodes atomically.
async function fbPatch(path, data, token) {
  const res = await fetch(`${DB}/${path}.json`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
}

// ── Cleanup tasks ─────────────────────────────────────────────────────────────

async function cleanKindlechatMessages(cutoff, token) {
  const data = await fbGet('kindlechat/messages', token);
  if (!data) return 0;

  const old = Object.entries(data).filter(([, v]) => v.timestamp <= cutoff);
  if (!old.length) return 0;

  await fbPatch('kindlechat/messages', Object.fromEntries(old.map(([k]) => [k, null])), token);
  return old.length;
}

async function cleanTopicComments(cutoff, token) {
  // Fetch both in parallel: all comments + all topics (to catch comment-less topics)
  const [allTopicComments, allTopics] = await Promise.all([
    fbGet('topic_comments', token),
    fbGet('topics', token),
  ]);

  const commentDeletions  = {}; // "topicId/commentId" → null
  const topicUpdates      = {}; // "topicId" → null  OR  "topicId/commentCount" → N
  const topicsWithContent = new Set(); // topics that still have ≥1 comment after cleanup

  let deletedComments = 0;
  let deletedTopics   = 0;

  // Pass 1: delete old comments; mark topics for deletion or count update
  if (allTopicComments) {
    for (const [topicId, comments] of Object.entries(allTopicComments)) {
      const old = Object.entries(comments).filter(([, v]) => v.timestamp <= cutoff);

      if (!old.length) {
        topicsWithContent.add(topicId);
        continue;
      }

      for (const [commentId] of old) commentDeletions[`${topicId}/${commentId}`] = null;
      deletedComments += old.length;

      const remainingCount = Object.keys(comments).length - old.length;
      if (remainingCount === 0) {
        topicUpdates[topicId] = null;
        deletedTopics++;
      } else {
        topicsWithContent.add(topicId);
        topicUpdates[`${topicId}/commentCount`] = remainingCount;
      }
    }
  }

  // Pass 2: catch topics that have no topic_comments entry at all (comments
  // were manually deleted by users, or the topic never received any comments)
  if (allTopics) {
    for (const [topicId, topicData] of Object.entries(allTopics)) {
      if (topicsWithContent.has(topicId) || topicUpdates[topicId] === null) continue;

      // Delete topics with no title (malformed) regardless of timestamp
      const hasTitle = topicData.title?.trim();
      const lastActivity = topicData.lastActive || topicData.timestamp || 0;
      if (!hasTitle || lastActivity <= cutoff) {
        topicUpdates[topicId] = null;
        deletedTopics++;
        // Also wipe any associated comments (defensive — shouldn't exist for
        // comment-free topics, but covers race conditions)
        commentDeletions[topicId] = null;
      }
    }
  }

  // Pass 3: delete orphaned topic_comments nodes whose topic no longer exists
  // in `topics` (e.g. deleted via admin tools or dedupe script outside this run)
  if (allTopicComments) {
    const existingTopicIds = allTopics ? new Set(Object.keys(allTopics)) : new Set();
    for (const [topicId, comments] of Object.entries(allTopicComments)) {
      if (existingTopicIds.has(topicId)) continue;
      // Delete the entire node rather than individual comments
      commentDeletions[topicId] = null;
      deletedComments += Object.keys(comments).length;
    }
  }

  if (Object.keys(commentDeletions).length) await fbPatch('topic_comments', commentDeletions, token);
  if (Object.keys(topicUpdates).length)     await fbPatch('topics',         topicUpdates,     token);

  return { comments: deletedComments, topics: deletedTopics };
}

async function cleanAutomodStrikes(cutoff, token) {
  const data = await fbGet('automod_strikes', token);
  if (!data) return 0;

  const updates = {};
  let cleaned = 0;

  for (const [uid, entry] of Object.entries(data)) {
    if (!entry || !Array.isArray(entry.strikes)) continue;
    if (entry.count >= STRIKE_LIMIT) continue; // banned user — preserve record

    const recent = entry.strikes.filter(s => s.ts > cutoff);
    if (recent.length === entry.strikes.length) continue; // nothing to prune

    if (recent.length === 0) {
      updates[uid] = null;
    } else {
      updates[uid] = {
        ...entry,
        strikes:      recent,
        count:        recent.length,
        firstStrikeAt: recent[0].ts,
      };
    }
    cleaned++;
  }

  if (Object.keys(updates).length) await fbPatch('automod_strikes', updates, token);
  return cleaned;
}

async function cleanNeighbourhoodPosts(cutoff, token) {
  const data = await fbGet('neighbourhood_posts', token);
  if (!data) return 0;

  const old = Object.entries(data).filter(([, v]) => v.timestamp <= cutoff);
  if (!old.length) return 0;

  await fbPatch('neighbourhood_posts', Object.fromEntries(old.map(([k]) => [k, null])), token);
  return old.length;
}

// ── Worker entry point ────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCleanup(env));
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/run') {
      return new Response('ReKindle cleanup worker — GET /run to trigger manually', { status: 200 });
    }
    try {
      const log = await runCleanup(env);
      return new Response(log, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    } catch (e) {
      return new Response(`ERROR: ${e.message}\n${e.stack}`, {
        status: 500, headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};

async function runCleanup(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set');
  const token = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT);

  const now           = Date.now();
  const threeDaysAgo  = now - THREE_DAYS_MS;
  const sevenDaysAgo  = now - SEVEN_DAYS_MS;
  const thirtyDaysAgo = now - THIRTY_DAYS_MS;

  const [chatDeleted, postsDeleted, { comments: commentsDeleted, topics: topicsDeleted }, strikesCleared] =
    await Promise.all([
      cleanKindlechatMessages(threeDaysAgo,  token),
      cleanNeighbourhoodPosts(thirtyDaysAgo, token),
      cleanTopicComments(sevenDaysAgo,       token),
      cleanAutomodStrikes(sevenDaysAgo,      token),
    ]);

  const summary = [
    `Cleanup complete — ${new Date(now).toISOString()}`,
    `  KindleChat messages deleted : ${chatDeleted}`,
    `  Topic comments deleted      : ${commentsDeleted}`,
    `  Topics deleted (no comments): ${topicsDeleted}`,
    `  Neighbourhood posts deleted : ${postsDeleted}`,
    `  Automod strike records aged : ${strikesCleared}`,
  ].join('\n');

  console.log(summary);
  return summary;
}
