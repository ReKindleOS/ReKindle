export async function onRequest(context) {
    const { request } = context;

    const corsHeaders = new Headers();
    corsHeaders.set('Access-Control-Allow-Origin', '*');
    corsHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', '*');
    corsHeaders.set('Content-Type', 'application/json');

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: corsHeaders
        });
    }

    const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
    const cacheKey = cache ? new Request(request.url, { method: 'GET' }) : null;

    if (cache && cacheKey) {
        try {
            const cached = await cache.match(cacheKey);
            if (cached) {
                return cached;
            }
        } catch (e) {
            console.error('Cache read failed:', e);
        }
    }

    try {
        const res = await fetch('https://www.espn.com/nrl/scoreboard', {
            headers: {
                'User-Agent': 'ReKindle-App/1.0 (https://github.com/cloud-nine-app/rekindle)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        if (!res.ok) {
            return new Response(JSON.stringify({ error: 'Upstream error ' + res.status }), {
                status: 502,
                headers: corsHeaders
            });
        }

        const html = await res.text();
        const events = parseNRLScoreboard(html);

        const responseBody = JSON.stringify({ events });
        const response = new Response(responseBody, {
            status: 200,
            headers: corsHeaders
        });

        if (cache && cacheKey && events.length > 0) {
            try {
                const cacheHeaders = new Headers(corsHeaders);
                cacheHeaders.set('Cache-Control', 'public, max-age=120');
                const cacheResponse = new Response(responseBody, {
                    status: 200,
                    headers: cacheHeaders
                });
                await cache.put(cacheKey, cacheResponse);
            } catch (e) {
                console.error('Cache write failed:', e);
            }
        }

        return response;

    } catch (e) {
        console.error('NRL scores error:', e);
        return new Response(JSON.stringify({ error: e.message || 'Unknown error' }), {
            status: 500,
            headers: corsHeaders
        });
    }
}

const NRL_TEAM_NAMES = new Set([
    'Broncos', 'Raiders', 'Bulldogs', 'Sharks', 'Dolphins', 'Titans',
    'Sea Eagles', 'Storm', 'Knights', 'Warriors', 'Cowboys', 'Eels',
    'Panthers', 'Rabbitohs', 'Dragons', 'Roosters', 'Wests Tigers'
]);

function isNRLMatch(competitors) {
    return competitors.every(c => NRL_TEAM_NAMES.has(c.team.shortDisplayName));
}

function parseNRLScoreboard(html) {
    const events = [];
    let currentDate = '';

    const tokenRegex = /(?:<header class="Card__Header[^"]*"[^>]*aria-label="([^"]*)"\s*>|<div class="ScoreboardScoreCell[^"]*ScoreboardScoreCell--(pre|post|in)[^"]*"[^>]*>)/g;

    let match;
    while ((match = tokenRegex.exec(html)) !== null) {
        if (match[1]) {
            currentDate = match[1];
        } else if (match[2]) {
            const state = match[2];
            const startIdx = match.index;
            const endIdx = findMatchingClose(html, startIdx);
            if (endIdx > startIdx) {
                const cellHtml = html.substring(startIdx, endIdx);
                const game = parseGameCell(cellHtml, currentDate, state, events.length);
                if (game && isNRLMatch(game.competitions[0].competitors)) events.push(game);
            }
        }
    }

    return events;
}

function findMatchingClose(html, startIdx) {
    let depth = 1;
    let i = html.indexOf('>', startIdx) + 1;
    while (i < html.length && depth > 0) {
        const openIdx = html.indexOf('<div', i);
        const closeIdx = html.indexOf('</div>', i);
        if (closeIdx === -1) return -1;
        if (openIdx !== -1 && openIdx < closeIdx) {
            depth++;
            i = openIdx + 1;
        } else {
            depth--;
            if (depth === 0) {
                return closeIdx + 6;
            }
            i = closeIdx + 1;
        }
    }
    return -1;
}

function parseGameCell(cellHtml, dateLabel, state, idx) {
    const competitors = [];
    const itemRegex = /<li class="ScoreboardScoreCell__Item[^"]*ScoreboardScoreCell__Item--(home|away)[\s\S]*?<div class="ScoreCell__TeamName ScoreCell__TeamName--shortDisplayName[^"]*">([^<]+)<\/div>(?:[\s\S]*?<div class="ScoreCell__Score[^"]*ScoreCell_Score--scoreboard[^"]*">([^<]*)<\/div>)?/g;

    let itemMatch;
    while ((itemMatch = itemRegex.exec(cellHtml)) !== null) {
        const name = itemMatch[2].trim();
        competitors.push({
            homeAway: itemMatch[1],
            score: (itemMatch[3] || '').trim(),
            team: {
                id: 'nrl-' + name.toLowerCase().replace(/\s+/g, '-'),
                shortDisplayName: name,
                abbreviation: name,
                logo: ''
            }
        });
    }

    if (competitors.length !== 2) return null;

    const shortDetail = state === 'post' ? 'Final' : (state === 'in' ? 'Live' : dateLabel);

    return {
        id: 'nrl-' + idx,
        date: dateLabel || undefined,
        competitions: [{ competitors }],
        status: {
            type: {
                state: state === 'post' ? 'post' : state === 'in' ? 'in' : 'pre',
                shortDetail: shortDetail
            }
        }
    };
}
