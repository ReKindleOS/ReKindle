/**
 * Same-origin proxy for the ReKindle commit history.
 *
 * The changelog page needs the public GitHub REST API, which is rate limited
 * to 60 requests/hour per IP for unauthenticated callers. Cloudflare Pages
 * Functions share egress IPs, so every page load fetching GitHub directly (or
 * through a dumb proxy) would exhaust that budget quickly. This Function:
 *
 *   GET /api/commits?page=1&per_page=100
 *
 *   - normalises each commit down to the handful of fields the page renders
 *     (the raw GitHub payload is several KB per commit)
 *   - caches each page at the edge for an hour, shared by all visitors
 *   - revalidates page 1 against GitHub's commit Atom feed (a feed request is
 *     not part of the 60/hour REST quota), so a push shows up within a minute
 *     instead of waiting for the hour cache to expire
 *   - lazily reports the total page count from GitHub's Link header
 *   - accepts an optional GITHUB_TOKEN binding (5,000 req/hour instead of 60)
 *
 * The repository is hard-coded: this endpoint is not a general GitHub proxy.
 */

const REPO = 'ReKindleOS/ReKindle';
const REPO_URL = 'https://github.com/' + REPO;
const API_BASE = 'https://api.github.com/repos/' + REPO + '/commits';
const FEED_URL = REPO_URL + '/commits/main.atom';

const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 100;
const MAX_PAGE = 500; // safety bound: 50,000 commits

const EDGE_TTL = 3600;      // shared edge cache: one upstream fetch / hour
const CLIENT_MAX_AGE = 600; // browser may reuse a page for 10 minutes
const FRESH_MAX_AGE = 60;   // page 1 can be replaced by a revalidated copy every minute

const HEAD_TTL = 60;          // Atom-feed head check: one request / minute / colo
const HEAD_TIMEOUT = 5000;
const HEAD_CACHE_PATH = '/api/commits/head';

const UPSTREAM_TIMEOUT = 10000;
const MAX_ATTEMPTS = 2;

const COMMIT_MESSAGE_LIMIT = 240;

export async function onRequest(context) {
    const request = context.request;
    const method = request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (method !== 'GET' && method !== 'HEAD') {
        return errorResponse(405, 'method_not_allowed', 'Method not allowed');
    }

    const url = new URL(request.url);
    const page = clampInt(url.searchParams.get('page'), 1, MAX_PAGE, 1);
    const perPage = clampInt(url.searchParams.get('per_page'), 1, MAX_PER_PAGE, DEFAULT_PER_PAGE);

    // The cache key includes both paging params, so pages never collide.
    const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
    const cacheKey = cache ? new Request(url.toString(), { method: 'GET' }) : null;

    let cached = null;
    if (cache && cacheKey && method === 'GET') {
        try {
            cached = await cache.match(cacheKey);
        } catch (e) {
            // Cache reads are best effort; fall through to the origin.
        }
    }

    // Page 1 is the only page that can be out of date in a way the reader
    // notices. GitHub's Atom feed is not part of the REST quota, so use its
    // newest SHA to decide whether the hour-long page cache is still current.
    let headSha = null;
    if (method === 'GET' && page === 1) {
        headSha = await fetchHeadSha(context, cache);
    }

    if (cached) {
        if (page !== 1 || !headSha) return cached;

        const cachedHead = await cachedHeadSha(cached);
        if (cachedHead && cachedHead === headSha) return cached;
        // A commit was pushed after this page was cached: fall through and refetch.
    }

    let upstream = null;
    try {
        upstream = await fetchCommitsPage(page, perPage, context.env);
    } catch (e) {
        upstream = null;
    }

    if (!upstream || !upstream.response) {
        return errorResponse(502, 'upstream_unreachable', 'GitHub could not be reached');
    }

    const response = upstream.response;

    if (response.status === 403 || response.status === 429) {
        // GitHub uses 403 for both primary and secondary rate limits.
        const reset = Number(response.headers.get('x-ratelimit-reset')) || 0;
        const retryAfter = response.headers.get('retry-after')
            ? Number(response.headers.get('retry-after'))
            : (reset > 0 ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 60);

        const headers = corsHeaders();
        headers.set('Retry-After', String(Math.min(3600, Math.max(1, retryAfter))));
        return jsonResponse({ error: 'rate_limited', message: 'GitHub API rate limit reached' }, 503, headers);
    }

    if (response.status === 404) {
        return errorResponse(404, 'not_found', 'Repository not found');
    }

    if (response.status !== 200) {
        return errorResponse(502, 'upstream_error', 'GitHub returned an unexpected response');
    }

    let items;
    try {
        items = await response.json();
    } catch (e) {
        return errorResponse(502, 'upstream_error', 'GitHub returned invalid JSON');
    }

    if (!Array.isArray(items)) {
        return errorResponse(502, 'upstream_error', 'GitHub returned an unexpected payload');
    }

    const commits = items.map(normalizeCommit);
    const totalPages = totalPagesFromLink(response.headers.get('link'));
    const hasMore = totalPages !== null ? page < totalPages : items.length >= perPage;

    const payload = {
        repo: REPO,
        repoUrl: REPO_URL,
        page: page,
        perPage: perPage,
        commits: commits,
        hasMore: hasMore,
        totalPages: totalPages !== null ? totalPages : (hasMore ? page + 1 : page),
        fetchedAt: new Date().toISOString()
    };

    const headers = payloadHeaders(page, commits);
    const result = jsonResponse(payload, 200, headers);

    if (cache && cacheKey && method === 'GET' && commits.length > 0) {
        try {
            const cacheHeaders = payloadHeaders(page, commits);
            await cache.put(cacheKey, jsonResponse(payload, 200, cacheHeaders));
        } catch (e) {
            // Cache writes are best effort too.
        }
    }

    if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: result.headers });
    }

    return result;
}

function payloadHeaders(page, commits) {
    const headers = corsHeaders();
    const head = commits.length ? commits[0].sha : '';
    const maxAge = page === 1 ? FRESH_MAX_AGE : CLIENT_MAX_AGE;
    headers.set('Cache-Control', 'public, max-age=' + maxAge + ', s-maxage=' + EDGE_TTL);
    if (head) {
        // Kept on the cached copy so a later request can tell whether the page
        // still matches GitHub's head without re-reading the whole body.
        headers.set('X-Changelog-Head', head);
        headers.set('Access-Control-Expose-Headers', 'X-Changelog-Head');
    }
    return headers;
}

function headCacheKey(requestUrl) {
    try {
        return new URL(HEAD_CACHE_PATH, requestUrl).toString();
    } catch (e) {
        return 'https://rekindle.ink' + HEAD_CACHE_PATH;
    }
}

/**
 * Newest commit SHA from GitHub's Atom feed, cached for a minute per colo.
 * The feed is a normal github.com response, not a REST API call, so checking
 * it does not consume the 60 requests/hour unauthenticated REST quota.
 */
async function fetchHeadSha(context, cache) {
    const key = cache ? new Request(headCacheKey(context.request.url), { method: 'GET' }) : null;

    if (cache && key) {
        try {
            const cached = await cache.match(key);
            if (cached) {
                const sha = (await cached.text()).trim();
                return sha || null;
            }
        } catch (e) {
            // Fall through to the feed.
        }
    }

    const sha = await fetchFeedHead(context.env);

    if (sha && cache && key) {
        try {
            const headers = new Headers();
            headers.set('Content-Type', 'text/plain; charset=utf-8');
            headers.set('Cache-Control', 'public, max-age=' + HEAD_TTL + ', s-maxage=' + HEAD_TTL);
            await cache.put(key, new Response(sha, { status: 200, headers: headers }));
        } catch (e) {
            // Head cache is best effort.
        }
    }

    return sha;
}

async function fetchFeedHead(env) {
    const headers = {
        'Accept': 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'ReKindle-Changelog/1.0 (+https://rekindle.ink/changelog)'
    };

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, HEAD_TIMEOUT);

    let response = null;
    try {
        response = await fetch(FEED_URL, {
            method: 'GET',
            headers: headers,
            redirect: 'follow',
            signal: controller.signal
        });
    } catch (e) {
        response = null;
    } finally {
        clearTimeout(timer);
    }

    if (!response || response.status !== 200) return null;

    try {
        return parseHeadSha(await response.text());
    } catch (e) {
        return null;
    }
}

export function parseHeadSha(xml) {
    if (typeof xml !== 'string' || !xml) return null;

    const entryAt = xml.search(/<entry(?:\s|>)/);
    if (entryAt === -1) return null;

    // The <id> is at the top of the first entry; a bounded slice keeps the
    // regex away from the rest of the (much larger) feed.
    const entry = xml.slice(entryAt, entryAt + 4096);
    const id = /<id>\s*tag:github\.com,2008:Grit::Commit\/([0-9a-f]{7,64})\s*<\/id>/i.exec(entry);
    if (id) return id[1];

    const link = /href="https:\/\/github\.com\/[^"/]+\/[^"/]+\/commit\/([0-9a-f]{7,64})"/i.exec(entry);
    return link ? link[1] : null;
}

async function cachedHeadSha(response) {
    if (!response) return null;

    const header = response.headers.get('X-Changelog-Head');
    if (header) return header;

    // Older cache entries predate the header; read the first commit instead.
    try {
        const data = await response.clone().json();
        if (data && Array.isArray(data.commits) && data.commits.length) {
            return data.commits[0].sha || null;
        }
    } catch (e) {
        // Ignore an unreadable cache entry; the caller will refetch.
    }

    return null;
}

async function fetchCommitsPage(page, perPage, env) {
    const headers = {
        'Accept': 'application/vnd.github+json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'ReKindle-Changelog/1.0 (+https://rekindle.ink/changelog)',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    // Optional: a token raises the unauthenticated 60 req/hour limit to 5,000.
    // Do not log it; never return it to the client.
    const token = env && (env.GITHUB_TOKEN || env.GITHUB_API_TOKEN);
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const target = API_BASE + '?per_page=' + perPage + '&page=' + page;
    let lastResponse = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            await sleep(retryDelay(lastResponse, attempt));
        }

        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, UPSTREAM_TIMEOUT);

        let response = null;
        try {
            response = await fetch(target, {
                method: 'GET',
                headers: headers,
                redirect: 'follow',
                signal: controller.signal
            });
        } catch (e) {
            response = null;
        } finally {
            clearTimeout(timer);
        }

        if (!response) continue;

        // Retry transient failures only. 403 is generally GitHub's rate limit
        // and retrying it immediately makes the situation worse.
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
            lastResponse = response;
            continue;
        }

        return { response: response };
    }

    return { response: lastResponse };
}

function retryDelay(response, attempt) {
    const retryAfter = response && response.headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (isFinite(seconds) && seconds > 0) return Math.min(seconds, 10) * 1000;
    }
    return attempt * 500;
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function clampInt(raw, min, max, fallback) {
    const value = parseInt(raw, 10);
    if (!isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

/**
 * Keep only what the changelog renders. GitHub's commit objects carry the
 * full commit body, tree/parent URLs, verification payloads and author/committer
 * objects; shipping all of that for 100 commits per page is megabytes of JSON.
 */
export function normalizeCommit(item) {
    const commit = item && item.commit ? item.commit : {};
    const author = commit.author || {};
    const committer = commit.committer || {};
    const githubAuthor = item && item.author ? item.author : {};

    let message = String(commit.message || '').split('\n')[0].trim();
    // Collapse tabs / repeated spaces so the list stays one tidy line.
    message = message.replace(/\s+/g, ' ').trim();
    if (message.length > COMMIT_MESSAGE_LIMIT) {
        message = message.slice(0, COMMIT_MESSAGE_LIMIT - 3).replace(/\s+$/, '') + '...';
    }

    const sha = String(item && item.sha ? item.sha : '');
    const date = author.date || committer.date || (item && item.commit && item.commit.committer && item.commit.committer.date) || '';
    const url = item && typeof item.html_url === 'string' && item.html_url.indexOf('https://github.com/') === 0
        ? item.html_url
        : (sha ? REPO_URL + '/commit/' + sha : REPO_URL);

    return {
        sha: sha,
        short: sha ? sha.slice(0, 7) : '',
        message: message,
        author: author.name || githubAuthor.login || 'Unknown',
        login: githubAuthor.login || '',
        date: date,
        url: url
    };
}

export function totalPagesFromLink(linkHeader) {
    if (!linkHeader) return null;

    const parts = String(linkHeader).split(',');
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!/rel="last"/.test(part)) continue;

        const match = /[?&]page=(\d+)/.exec(part);
        if (match) {
            const page = parseInt(match[1], 10);
            if (isFinite(page) && page > 0) return page;
        }
    }

    return null;
}

function corsHeaders() {
    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('X-Content-Type-Options', 'nosniff');
    return headers;
}

function jsonResponse(body, status, headers) {
    return new Response(JSON.stringify(body), {
        status: status,
        headers: headers || corsHeaders()
    });
}

function errorResponse(status, code, message) {
    const headers = corsHeaders();
    headers.set('Cache-Control', 'no-store');
    return jsonResponse({ error: code, message: message }, status, headers);
}
