# Link / URL Blocking in Social Apps

KindleChat, Neighbourhood and Topics reject content containing a link
("Links and URLs are not allowed."). Enforcement is **client-side and
server-side** — never rely on the page alone, since the worker is reachable
directly.

## Why a plain domain regex is not enough

On 2026-10-26 a user advertised a new competing site with the dots replaced:

```
nexora-chat-v12,netlify,app/ NEW WEBSITE v12
```

A comma-split domain is not clickable, but it is perfectly readable — so the
old `\b[a-z0-9-]+\s*\.\s*(tld)\b` check let it through. Other forms in the same
family:

| Form | Example |
| :--- | :--- |
| commas / pipes / underscores | `nexora-chat-v12,netlify,app`, `netlify\|app`, `netlify_app` |
| spaces | `nexora-chat-v12 netlify app`, `netlify app` |
| spelled-out dot | `netlify dot app`, `netlifyDOTapp`, `netlify[.]app`, `netlify(dot)app` |
| unicode / invisible | `nexora。netlify。app`, zero-width characters inside a label |
| protocol variants | `hxxp://`, `h t t p s : / /` |
| IPs | `127.0.0.1` (also with spaces around the dots) |

## Implementation

*   **Client:** `js/link-guard.js` exposes `window.rekindleContainsLink(text)`.
    Loaded by `kindlechat.html`, `neighbourhood.html` and `topics.html`
    (`<script src="js/link-guard.js?v=1">`, right after `js/promo-ban.js`).
    Each page's local `containsUrl()` delegates to it and keeps the old checks
    as a fallback if the helper fails to load.
*   **Server:** `containsUrl()` in `workers/rekindle-moderate/worker.js` carries
    a mirror of the matcher (`LINK_*` names) for every content type
    (`kindlechat`, `dm`, `dm_request`, `topic`, `topic_comment`,
    `neighbourhood_post`, `neighbourhood_comment`).
*   **Parity test:** `node scripts/test-link-guard.js` runs one corpus through
    both and is part of `npm test`. Change the helper and the worker together.

### How detection works

1.  **Normalise** (`linkNormalizeText` / `normalize`): NFKC (full-width →
    ASCII), unicode dots/bullets → `.`, `[.]`/`(dot)`/`{DOT}` → `.`, glued
    uppercase `DOT` and spaced `dot` → a placeholder, zero-width/soft-hyphen
    characters removed, lowercase.
2.  **Legacy checks** still run first: protocol (`http`, `https`, `hxxp`,
    spaced letters), `www.`, dotted domain, dotted IP.
3.  **Label runs:** every run of hostname labels (`[a-z0-9-]+`) joined by
    dot-like separators is walked. A slash/query ends the host (a trailing
    slash counts as a host signal).
4.  **A window (2–4 labels) is a link** when its last label is a TLD *and* it
    looks like a host, not a sentence:
    *   real dots → left to the legacy dotted check (keeps sentence-boundary
        behaviour such as "home. Me too" unchanged);
    *   spaces only → needs a host signal: a label with a digit or hyphen,
        `www`, a known hosting suffix (`netlify.app`, `vercel.app`,
        `github.io`, …), or a trailing slash. Two-label `"example com"` is
        also caught for `com|net|org` when the first label is 5+ characters;
    *   comma/bracket/spelled-dot → two labels need a digit/hyphen label, a
        known hosting suffix, or a 5+ character first label; three or more
        labels are treated as a host unless the TLD is an ordinary English
        word (`WORD_TLDS`: `me`, `to`, `it`, `site`, `link`, …) and there is no
        host signal.

The word-TLD exemption is what keeps chat usable: `"hello, me and my friend"`,
`"yes, to me"`, `"I love this online"`, `"send me, link"`, `"good morning,
world"` and `"this is a great app"` are all allowed, while
`"nexora-chat-v12,netlify,app/"` is blocked by its hyphen/digit label and
trailing slash.

### Trade-offs / known limits

*   Mentions of a hosting platform with a space (`"the netlify app"`) are
    blocked deliberately — it is the same string an evader posts.
*   A fully letter-spaced domain (`"n e x o r a . c o m"`) is not detected;
    it is hard to read and rare.
*   `HOST_SUFFIXES`, `WORD_TLDS` and the TLD list are heuristics. When adding
    a platform or a TLD, add a case to `scripts/test-link-guard.js` first.

## Cache busting

`js/link-guard.js` is a shared versioned script: bump `?v=N` in **all three**
pages when it changes (see the cache-busting table in `AGENTS.md`). It is not
in `sw.js` `ASSETS_TO_CACHE` (same as `js/promo-ban.js`).
