# Third-Party Integrations

Akinator, NRL scores and the Internet Archive comic reader. Read before touching those pages or their backing Pages Functions.

## 🏉 NRL Scores (scores.html)

ESPN's JSON scoreboard API (`site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`) supports NFL/NBA/MLB/NHL/soccer/AFL but **does not expose NRL**. To add NRL, `scores.html` uses a dedicated Cloudflare Pages Function at `functions/api/nrl-scores.js` that scrapes `https://www.espn.com/nrl/scoreboard` and returns ESPN-compatible JSON.

*   The scraper is regex-based and relies on ESPN's current server-rendered HTML structure. If ESPN changes their markup, the parser will return empty events.
*   Only games where both teams are in the known NRL team list are returned (filters out State of Origin / Tests).
*   The response is cached for 2 minutes via `caches.default`, but only when games are successfully parsed.
*   In `scores.html`, NRL is added to `LEAGUES` with `source: "nrl-scores"`, and `fetchFromAPI()` routes it to `/api/nrl-scores` instead of the ESPN proxy.

## 📚 Comic Reader (comics.html) — Internet Archive, not MangaDex/Manga Plus

`comics.html` (dashboard id `comics`, formerly `manga.html`) was rewritten (2026-07) to remove MangaDex (unlicensed scanlations = piracy). It is now a **public domain / openly licensed comic reader** backed by the Internet Archive. The original MangaDex app survives untouched as `manga.html` (a copy of the old `mangadex.html`, still redirecting to `index`); it is not linked from the dashboard.

### Why not Manga Plus (official Shueisha)?
Manga Plus was evaluated and is **technically unusable** for this project:
1.  **Datacenter IP ban:** `jumpg-webapi.tokyo-cdn.com` returns a protobuf "Account Banned (10900)" error for ALL Cloudflare egress IPs (verified via the deployed `/api/proxy`) and VPN/unknown IPs. It only works from clean residential IPs.
2.  **CORS-locked:** the API only sends `access-control-allow-origin: https://mangaplus.shueisha.co.jp`, so the Kindle browser cannot call it directly.
3.  **Protobuf-only:** responses are `application/x-protobuf`; there is no JSON mode.

### Internet Archive integration (what the app uses)
*   **Catalog search:** `https://archive.org/advancedsearch.php?q=mediatype:texts AND collection:comics* AND licenseurl:*&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=20&page=N&sort[]=downloads desc&output=json`. The `licenseurl:*` filter is **mandatory** — the general `comics` collections are full of pirated Disney/manga scans; only items with an explicit license (public domain mark, CC) are legal. Sends `access-control-allow-origin: *`, so it is fetched **directly** (no proxy).
*   **Metadata:** `https://archive.org/metadata/{id}` — also CORS-open, direct fetch. Used to find the `*_scandata.xml` file. Note: `metadata.imagecount` is often absent, so page count must come from scandata.
*   **Scandata:** `https://archive.org/download/{id}/{file}_scandata.xml` — **does NOT send CORS headers**, so it is fetched through `/api/proxy` (IA does not ban cloud IPs). Parse with `DOMParser`, collect `<page leafNum="N">` where `addToAccessFormats != false`.
*   **Page images:** `https://archive.org/download/{id}/page/n{leaf}_w1080.jpg` — 302-redirects to `ia*.us.archive.org/BookReader/BookReaderImages.php`. Used as direct `<img src>` (no CORS needed for images).
*   **Covers:** `https://archive.org/services/img/{id}` — direct `<img src>`.
*   Items without scandata (CBZ-only uploads) cannot be read in-app; the reader shows an "Open on archive.org" fallback link.

### Library migration
Library items are stored in localforage key `manga_library` and must have `source: 'ia'` (IA identifier as `id`). Legacy MangaDex entries (UUID ids) are silently dropped on load with a status-bar notice.

### Dashboard entry
The `icons.js` entry uses `id: 'comics'` (file `comics.html`) with `name: 'Comics'`. All locale files translate `manga.title` as their word for "Comics".

## Akinator (`akinator.html` + `akinator-service/`)

**Current transport (2026-10-21):** an always-on Node relay on Northflank's free Developer Sandbox. The public CORS proxies are gone (dead since 2026-07) and Firebase Functions no longer handles Akinator.

### Why it moved off Firebase (2026-10-21)
Measured with Cloud Monitoring before the move:

- ~98,400 requests in 43 h ≈ **1.65M requests/month**, ~2,300 games/day; P50 430 ms, P95 ~720 ms.
- ~5,700 vCPU-s/day ≈ **171k vCPU-s/month** — about 85% of Google's 200k CPU-s free tier from this function alone.
- Traffic was real Kindle/Fire clients, not one scraper.

Cloud Run would not have helped: Firebase Functions 2nd gen **is** Cloud Run, sharing the same Google Cloud billing account and free allotment. At 1.65M requests/month, per-request free tiers (AWS Lambda 1M requests + 400k GB-s, Azure Functions 1M + 400k GB-s) do not stay free either. Northflank's Developer Sandbox is free forever, **always-on (no sleeping)**, 2 services, no request metering.

### Why the public proxies all died
Akinator.com's Cloudflare now fingerprints the **TLS ClientHello (JA3/JA4)**, not just headers:

- Browser `fetch`, `curl`, Node `undici` (even with a full Chrome header set) and **Cloudflare Workers/Pages Functions** all get the 403 "Just a moment..." challenge page. Verified against the deployed `rekindle.ink/api/proxy`.
- `got-scraping` (Chrome TLS + HTTP/2 fingerprint) gets the real page and JSON, from a residential IP, Cloud Run and Northflank.
- Every public proxy is dead: `test.cors.workers.dev` → Cloudflare `error 1027` (account banned for abuse), `corsproxy.io` → Cloudflare challenge, `codetabs`/`allorigins` → 522, `cors.lol` → 429, several others → 404/DNS fail.
- `en.akinator.com` sends **no** `Access-Control-Allow-Origin`, so the browser can never call it directly. A relay is unavoidable.
- Cloudflare Workers cannot fake a Chrome TLS fingerprint, so the old `workers/rekindle-akinator/` worker (still in the repo, undeployed) would fail even if redeployed. That is why the relay is a plain Node process on Northflank.

### The relay
Source lives in `akinator-service/`: `akinator.js` (the handler), `app.js` (Express app) and `server.js` (the `$PORT` listener). It has no Firebase/GCP dependency; the same image runs on any Node host.

- URL: `https://p01--akinator--lcgj9cjkcx8q.code.run`
- Host: Northflank Developer Sandbox, US East. Dockerfile build; **build context `akinator-service`**, Dockerfile path `/akinator-service/Dockerfile`; port `8080` HTTP; health check `/healthz`; `nf-compute-20` (0.2 vCPU / 512 MB), always-on.
- Deploy: push to `main`, then rebuild/redeploy the service in Northflank. Verify with `cd akinator-service && ./smoke.sh <url>`.
- **Cost:** $0 on the Sandbox; no request metering. A card is required for identity verification, and the free plan blocks overages rather than billing.
- **Stateless**: one HTTP request → one Akinator request. The `session` token is all that is needed (verified with and without cookies), so no Firestore/RTDB is used.
- CORS allowlist: the four `rekindle.ink` origins + localhost. OPTIONS answered manually.
- Per-process token bucket (~120 burst, 2 req/s per IP) as a cheap abuse guard; keyed off the first `x-forwarded-for` entry.
- `got-scraping` is imported lazily so the process starts before the first game request.
- In `akinator.html`, the relay is now the **only** transport; the dead public proxies were removed on 2026-10-21. `BACKEND_URL` is the Northflank URL.

Request/response contract:

| Request | Response |
| :--- | :--- |
| `{action:'start', region, childMode}` | `{session, question, step:1, progression:0, answers[], baseUrl, sid, region}` |
| `{action:'answer', region, childMode, session, step, progression, answer:0-4, stepLast}` | `{step, progression, question}` or `{..., guess:{id,name,description,photo,noQuestion}}` |
| `{action:'back', region, childMode, session, step, progression}` | `{step, progression, question}` |
| `{action:'continue', region, childMode, session, step, progression}` | `{step, progression, question}` or next `guess` |

Errors: `{error:'session_expired'|'bad_request'|'upstream_blocked'|'upstream_timeout'|'upstream_parse', message}` with 400/409/502/504. `session_expired` is **not** retried on another transport — the page shows the modal and resets to the start screen.

### Akinator protocol changes (2026-10) — the bugs that broke the page even with a working proxy
1. **`step` starts at 1**, not 0. Sending `step: 0` makes `/answer` return `{"completion":"KO"}`; the old page treated that as "no new question" and silently re-rendered the same question forever.
2. **`signature` no longer exists** anywhere in the page (no hidden input, no JS variable). The old `apiStart()` required it, so every start threw even when the transport worked.
3. `/cancel_answer` must receive the **current** step, not `step - 1`. The wrong value returns the full HTML game page instead of JSON (and invalidates the session). Back is only valid during a question, never at a proposition.
4. `/exclude` still needs `forward_answer: '1'`. After a wrong guess the returned `step` can jump (e.g. 9 → 11); always copy `step`/`progression` from the response.
5. Guesses may carry `no_question: "1"` (genie out of questions); the page then ends the game instead of continuing.

### Endpoint details
- Start: `POST /game` with `cm`, `sid`, `anim` → HTML. Parse `session: '...'` and the `id="question-label"` `<p>` (the tag spans two lines — match `id` without requiring `class` to come first).
- Themes: characters `sid=1`, objects `2`, animals `14`.
- `region` maps to `<lang>.akinator.com`. Only these hosts resolve: en, de, es, fr, it, nl, pl, pt, ru, tr, id, ar, cn, il, jp, kr, uk, vn, fa. (`gr` and `sp` do **not** — the page uses `es` for Spanish and `jp` for Japanese.)
- Answer labels: `a_yes`, `a_no`, `a_dont_know`, `a_probably`, `a_probaly_not` (Akinator's own typo).
- Action response fields: `step`, `progression`, `question`, `id_proposition`, `id_base_proposition`, `name_proposition`, `description_proposition`, `photo`, `no_question`, or `completion: "KO"`.
- `X-Requested-With: XMLHttpRequest`, `Origin` and `Referer` (…/game, or …/theme-selection for `/game`) are all sent by the relay.

### Testing
- `node scripts/test-akinator.js` — 21 offline tests (parsers, CORS, validation, per-IP rate limit). Part of `npm test`.
- Local: `cd akinator-service && npm ci && PORT=8080 npm start`.
- Deployed: `cd akinator-service && ./smoke.sh https://p01--akinator--lcgj9cjkcx8q.code.run` — health, CORS preflight, start, answer and back against the real Akinator.
- Full game without a browser: run the extracted inline script in a `vm` sandbox with a fake DOM (the 2026-10 harness); the fast path is to play on beta/prod.

---

## 📚 Project Gutenberg + Standard Ebooks (reader.html, 2026-10-20)

In-app search and reader for Project Gutenberg's ~70,000 books, added as the
in-app counterpart to `epub.html` (which only links out to gutenberg.org).

### Merged into the Reader app (2026-10-20)
The standalone `gutenberg.html` and `standardebooks.html` apps were removed; both
now live in `reader.html` as tabs in the library overlay: **My Books**,
**Gutenberg**, and **Standard Ebooks** (`app.standardebooks.name` supplies the
third tab label so it stays translated in every locale).

- **Gutenberg tab**: OPDS search + subject chips, a "Continue reading" shelf
  (`rekindle_gb_recent`), a "Popular Now" browse list, and per-result **Read**
  (the plain-text pane, unchanged) and **Get** (downloads `ebooks/{id}.epub3.images`
  into the shared library). The old reader "Online Store" tab searched gutendex
  and was removed; its categories became the OPDS chips and its "Popular Now"
  now uses Gutenberg's own `sort_order=downloads` feed. `gutendex.com` is no
  longer called anywhere in the app.
- **Standard Ebooks tab**: the new-releases grid, blank-page-cleaned EPUB
  download, and the same `localforage` `library_index`/Firestore `library`
  writes as before. The feed is fetched lazily the first time the tab opens.
- **Standard Ebooks feed shape (2026-10-20)**: `/feeds/rss/new-releases` now
  301s to `/feeds/atom/new-releases`. The parser accepts both: RSS `<item>`
  (an `<enclosure>` plus `"Title, by Author"`) and Atom `<entry>` (an
  `<author><name>` and `<link rel="enclosure" type="application/epub+zip">`).
  The old `standardebooks.html` only looked for `<item>`, so against today's
  Atom feed it found zero entries and rendered "No items found in XML".
  Verified against the live feed (15 entries, first card title/author correct).
  Pick the first `rel="enclosure"` EPUB link (the "Recommended compatible
  epub") when several formats are listed.
- **Storage keys are unchanged** (`rekindle_gb_recent`, `rekindle_gb_pos_<id>`,
  `rekindle_gb_font`), as is the `rekindle-gutenberg-v1` Cache API bucket, so
  shelves/positions saved by the old app survive the merge.
- The text reader is a full overlay under the title bar (`#gb-reader`), so it
  does not disturb the EPUB.js toolbar; **Back** returns to the Gutenberg tab.
- Both download paths (`fetchAndSaveBook` in reader.html) pick `/api/gutenberg`
  for `gutenberg.org` URLs and `/api/proxy` for everything else, and dedupe the
  Firestore document with a `where('url','==',...)` query so a download that
  races the auth listener cannot create duplicates.
- Kindle constraint: the subject chips are a single horizontally scrollable row
  (`overflow-x:auto`, no flex `gap`) to keep the search header shallow.

### Gutendex is dead — use Gutenberg's own OPDS
The obvious API, `gutendex.com`, was unreachable when this was built (connection
hangs, then `000`; its API now 301-redirects to itself). Do **not** reintroduce it
as the primary search source.

Use the official catalogue instead:

| Need | URL |
| :--- | :--- |
| Search | `https://www.gutenberg.org/ebooks/search.opds/?query=<q>` |
| Popular browse | `https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads` |
| EPUB download | `https://www.gutenberg.org/ebooks/{id}.epub3.images` (302 → `cache/epub/{id}/pg{id}-images-3.epub`) |
| Next page | follow the feed's own `<link rel="next" href="...&start_index=26">` |
| Book text (primary) | `https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt` |
| Text fallbacks | `/files/{id}/{id}-0.txt`, `/ebooks/{id}.txt.utf-8` (302 → follow) |

Search results are Atom `<entry>` blocks carrying `<title>`, `<content type="text">`
(author) and `https://www.gutenberg.org/ebooks/{id}.opds`. There is **no
download_count and no language** in the search feed, and no plain-text link in the
detail feed — the text URL has to be constructed from the id. Thumbnails are
multi-KB base64 data URIs: strip `<link ... rel="http://opds-spec.org/image" .../>`
before matching entries or the regex pass gets expensive on the Kindle. Regex
parsing beats `DOMParser` here for the same reason.

### CORS and the proxy
`www.gutenberg.org` sends no CORS headers, so every OPDS/text fetch goes through
`functions/api/gutenberg.js?url=<encoded>` first, with a direct `fetch` only as a
last resort. The proxy mirrors `functions/api/reddit.js`: exact allowlist
(`gutenberg.org`, `www.gutenberg.org` — no suffix matching), GET/HEAD only,
`redirect:'follow'`, 15s `AbortController` timeout, `body.tee()` +
`context.waitUntil` edge caching, and 3 attempts with 400ms/1200ms backoff on
429/5xx (honouring `Retry-After`). Cache TTLs: 1800s for `.opds`, 86400s for
`.txt`, 3600s otherwise.

### Reader choices that matter on e-ink
- **Pagination by viewport, not measurement**: the pane is fixed-height and
  `overflow-y:auto`; Prev/Next set `scrollTop` by exactly `clientHeight`
  (instant, never smooth). Page count is `ceil(scrollHeight/clientHeight)`; when
  `scrollTop >= scrollMax - 0.5` the index is pinned to the last page so the final
  partial page is reachable and Prev can leave it.
- **One `innerHTML` for the whole book**: thousands of individual paragraph
  appends would each trip the i18n `MutationObserver`.
- **Cache-first reopen**: browser Cache API `rekindle-gutenberg-v1` keyed by the
  text URL, then network. Guard `typeof caches !== 'undefined'` — the Kindle
  browser may not have it.
- Text is cleaned between the `*** START/END OF (THE|THIS) PROJECT GUTENBERG
  EBOOK ***` markers, CRLF normalised, 3+ blank lines collapsed. Over 2,000,000
  chars is truncated with a visible notice rather than risking a jitless freeze.

### Storage keys
`rekindle_gb_recent` (`{id,title,author,pct,ts}`, max 8), `rekindle_gb_pos_<id>`
(`{scrollTop, pct}`), `rekindle_gb_font` (16/18/20/24).

### Testing
Local static servers cannot exercise Pages Functions, and direct gutenberg.org
fetches fail CORS locally, so expect the network-error state outside
`wrangler pages dev`/Pages. The tab can be driven headlessly with `jsdom` and a
stubbed `window.fetch` returning a saved OPDS feed + a text excerpt (verified
2026-10-20: 25 Dickens results, correct first title, contents modal, paragraph
render, error state, shelf). The proxy was tested in Node against the live site
(allowlist, 403/405/OPTIONS/HEAD, redirect-follow, cache headers all correct).
Standard Ebooks uses the Firebase relay below (not `/api/proxy`); its feed
parsing and EPUB cleaner were carried over unchanged.

### Standard Ebooks 403s every Cloudflare egress IP (2026-10-20)

**Symptom:** the Standard Ebooks tab never loads. Console:

```
[Error] Failed to load resource: the server responded with a status of 403 () (proxy, line 0)
[Error] Standard Ebooks feed error – Error: Status 403
```

**Cause:** `standardebooks.org` (plain Apache, no CDN in front) rejects requests
that arrive from Cloudflare's egress network (AS132892 — the Workers/Pages
range; the proxy's source IP was `2a06:98c0:3600::103`). It is **not** a
User-Agent, header, CORS or proxy bug, so no change to `functions/api/proxy.js`
can fix it:

| Check | Result |
| :--- | :--- |
| Same feed URL + the proxy's exact UA from a non-Cloudflare IP | 200 |
| `/api/proxy?url=https://example.com` | 200 |
| `/api/proxy?url=https://standardebooks.org/...` (any path) | 403, Apache `403 Forbidden` body |
| A second, unrelated Cloudflare Worker fetching the feed | 403 |
| Direct request from a non-Cloudflare IP carrying `CF-Connecting-IP` | 403 (so the rule keys on Cloudflare markers, not just the IP) |
| The same request through the Google Cloud relay | 200 |

The block is on the source IP, and Cloudflare-hosted code cannot change its
egress. (The 2026-10 hardened `/api/proxy` — header allowlist, redirect
re-validation, 10 MB cap — makes no difference here: the upstream rejects the
connection before headers matter.)

**Fix:** `firebase-functions/standardebooks.js`, exported as `standardebooks`
(`onRequest`, us-central1, 256 MiB, 60 s). Google Cloud egress is allowed, the
same workaround family as the Akinator relay (see `akinator-service/`),
without needing a TLS fingerprint — plain `fetch` works.

- Contract: `GET|HEAD /?url=https%3A%2F%2Fstandardebooks.org%2F...`
  (identical to `/api/*` so `reader.html` only swaps the base URL).
- Allowlist: `https` only, hosts `standardebooks.org` + `www.standardebooks.org`,
  paths `/feeds/` and `/ebooks/` only. Cover images are `<img>` loads straight
  from standardebooks.org and never need a proxy.
- Redirects followed (`/feeds/rss/*` 301s to `/feeds/atom/*`), 20 s feed /
  55 s download timeout, 3 attempts on 429/5xx with backoff honouring
  `Retry-After`.
- Feed bodies cached per instance for 30 min; `Cache-Control: public,
  max-age=1800` (feeds) / `86400` (downloads).
- Per-instance token bucket (60 requests/min per IP, refill 1/s) — it is a
  public unauthenticated relay, so a cheap abuse guard matches the Akinator
  relay's pattern. Normal use is one feed fetch plus one request per book.
- CORS origin allowlist: rekindle.ink, beta/lite/legacy subdomains,
  `rekindle.pages.dev`, localhost.

`reader.html`'s `proxyBaseFor()` now routes standardebooks.org to
`https://us-central1-rekindle-dd1fa.cloudfunctions.net/standardebooks?url=`
(hard-coded, like `akinator.html`'s `BACKEND_URL`), gutenberg.org to
`/api/gutenberg`, and everything else to `/api/proxy`.

**Deploy:** `npx firebase-tools deploy --only functions:standardebooks
--project rekindle-dd1fa`. No Firestore/RTDB/Auth rules are involved (the relay
is stateless). If Standard Ebooks ever allowlists Cloudflare, delete the
function and point `proxyBaseFor()` back at `/api/proxy`.

**Known limit:** Cloud Functions HTTP responses are capped at 10 MB.
New-release EPUBs are ~0.6–1.7 MB (max `length` in the 2026-10-20 feed), so this
is ample; a >10 MB book would fail to download through the relay.

**Verified 2026-10-20:** relay returns the 64,684-byte Atom feed (15 entries,
`application/atom+xml`) and a 1,076,225-byte EPUB; disallowed host/path/port →
403, missing `url` → 400, `OPTIONS` → 204 with the caller's origin echoed, and
the bucket returns 429 JSON after 60 requests. That handler behaviour was
checked by requiring the module in Node with fake `req`/`res` objects (note:
`req.query.url` arrives **decoded** — encoding it again fails the allowlist).
A jsdom harness (install `jsdom` in a temp dir — there is no committed test for
this tab) extracted `proxyBaseFor`, `fetchWithTimeout`, `escapeHtml` and the `SE`
IIFE from reader.html and drove the **live** relay: 15 cards, first card "Moral
Letters to Lucilius / Seneca", correct cover URL, then a real EPUB download
saved to localforage (`PK` ZIP magic). jsdom 30 has no `fetch` (inject Node's)
and its `FileReader` rejects undici `Blob`s (stub `blobToArrayBuffer`).

## 📝 Changelog + GitHub commits (changelog.html, 2026-10-22)

`changelog.html` is the About modal's "Changelog" link (`index.html` and the Lite/Legacy `index_old.html`). It lists the commit history of `ReKindleOS/ReKindle`, newest first, with a client-side filter and both "load older" (one page) and "load all" actions.

*   **`functions/api/commits.js`** is the only data source. It is hard-coded to one repository (not a general GitHub proxy), validates `page`/`per_page` as bounded integers, and returns a **normalised** payload: `sha`, `short`, first line of the message (≤240 chars), author name/login, ISO date, and commit URL. GitHub's raw commit objects carry the full body, parents, tree and verification payloads; returning them for 100 commits per page is megabytes of JSON on a Kindle.
*   **Rate limits / caching:** unauthenticated GitHub allows 60 requests/hour per IP. Pages Functions share egress IPs, so each page is cached at the edge for **1 hour** (`s-maxage=3600`, browser `max-age=600`) and the client asks for 100 commits per request (8 requests for ~750 commits). On a cache miss the Function retries `429`/`5xx` twice, maps GitHub rate limits to `503 {error:"rate_limited"}` with `Retry-After`, and never exposes the upstream body. The page shows a Retry button and a GitHub fallback link.
*   **Optional `GITHUB_TOKEN` binding:** set it in the Cloudflare Pages project environment to raise the limit to 5,000/hour. `context.env.GITHUB_TOKEN` (or `GITHUB_API_TOKEN`) is attached as a bearer header and is never logged or returned. Without it the edge cache is what keeps the endpoint inside the anonymous quota; do not add a client-side cache-busting query parameter.
*   **Do not pass `?refresh=...` or any user-controlled value through to GitHub.** The repository and query shape are fixed; only numeric paging is accepted.
*   **Tests:** `node scripts/test-commits.js` (wired into `npm test`) covers normalisation, Link-header paging, method guards, the upstream request shape, and rate-limit mapping. There is no network access in the test.

## ReKindle+ custom claims (2026-10-20)

`workers/rekindle-stripe/worker.js` sets the `pro` custom claim from the Stripe
webhook. Identity Toolkit's `accounts:update.customAttributes` **replaces** the
whole claims object, so the worker now reads `accounts:lookup` first and merges
via `workers/rekindle-stripe/claims.js` (`mergeClaims`). The same merge is used
by `admin/grant_pro.js`. Without it, buying or cancelling Pro deleted
`ageVerified`/`moderator`, locking the user out of social apps.

`getSocialToken` also lazily repairs a missing `ageVerified` claim from
`users/{uid}/ageVerification/latest`, and resolves Pro from the claim, the
`users/{uid}.proExpiresAt` document, or `config/supporters` so an existing
subscriber is not blocked by a stale token. Deploy the Stripe worker separately
(`cd workers/rekindle-stripe && npx wrangler deploy`), then run the
`/sync-pro-claims` admin endpoint once to backfill claims. Unit test:
`node scripts/test-claims.js`.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).

## 2026-10-21 backlog pass

- **`stocks.html`** fetches in batches of 4 with a single retry instead of firing every symbol at
  once (3 retries each) at the shared Cloudflare egress.
- **`bluesky.html`** reuses the rendered timeline for 5 minutes and caps embeds at two images.
- **`mail.html`** appends a page of rows on "load more" instead of rebuilding the whole list.
- **`sheetmusic.html`** composer images are LRU-capped at 100 `localStorage` entries.
- **`functions/api/price.js`** already had the edge cache/stale fallback from the previous pass.

## 2026-10-24: Substack relay moved to Firebase (two independent breaks)

**Symptom:** Substack users saw an empty feed ("No posts found."), so a broken
proxy looked like an empty account.

### Break 1 — the legacy endpoint stopped working

`/api/v1/subscriptions` now returns
`400 {"errors":[{"param":"tvOnly","msg":"Invalid value"}]}` without a `tvOnly`
param, and with `tvOnly` present it returns
`{"subscriptions":[],"publications":[]}` for an account that really has three
subscriptions. Substack's own web app uses **`/api/v1/subscriptions/page_v2`**,
which returns the same `{subscriptions, publications, ...}` shape the client
already merged (three publications for the test account). `/api/v1/feed/following`
only returns publication IDs, and `/api/v1/reader/feed` is the modern mixed
notes/comments home feed — neither is a drop-in for the per-publication posts the
app renders.

### Break 2 — Cloudflare Worker egress is rate-limited

`workers/rekindle-substack` forwarded `substack.com/api/v1/...` from Cloudflare
Worker egress. Substack answered a large share of those requests with
`429 Too Many Requests` (17-byte body, `x-served-by: Substack`, no `Retry-After`):

| Path | Result |
| :--- | :--- |
| Deployed worker, repeated probes | 2-3 of 10 replies `200`; the rest `429` |
| Every endpoint (`/subscriptions`, `/posts`, `/publication/search`) | same mix |
| Minimal UA vs full Chrome `sec-ch-*` / `Accept-Language` / `Referer` | no difference |
| `wrangler dev --remote` (Cloudflare egress) with minimal headers | `429` |
| Same requests from a residential IP | `200` 8/8 |

A Worker cannot choose its egress, and in-worker retries only raise volume from
an already limited IP. `substack.com` sends no CORS headers, so the browser cannot
call it directly either.

### Fix — `firebase-functions/substack.js` (Google Cloud, us-central1)

Deployed as `exports.substack`:

```
https://us-central1-rekindle-dd1fa.cloudfunctions.net/substack?path=/api/v1/...&host=<publication host>
```

* `Authorization: Bearer <Firebase ID token>` is **required** (verified with
  `admin.auth().verifyIdToken`) — otherwise this would be an open proxy on the
  project's GCP egress. Per-uid token bucket: 300 capacity, 5/s refill.
* `path` must start `/api/v1/`; `host` defaults to `substack.com` and is validated
  as a public hostname (no IP literals, ports, `.local`/`.internal`/metadata,
  wildcard-DNS rebinding suffixes). Publication custom domains work, which is why
  the host is not limited to `*.substack.com`. Redirect targets are re-checked.
* `X-Substack-SID` is forwarded only as the `substack.sid` cookie; it is never
  logged or stored. 2 attempts on 429/5xx; no response caching (per-user data).
* No warm instance: a cold start adds 10-30s to the first feed load of a
  session. `minInstances: 1` would remove that, but it is an always-on cost
  (~$10/month at 0.167 vCPU / 256MiB, partly inside the free tier), so it is
  deliberately left at 0; `maxInstances: 10` still caps scale. Deploying a warm
  instance later requires `--force` (Firebase blocks functions that raise the
  minimum bill).
* Guards: `node scripts/test-substack.js` (wired into `npm test`).

**Client (`substack.html`):** `apiCall()` now sends a fresh ID token to the
function and passes the target host as `host`; the subscriptions call uses
`/subscriptions/page_v2`. `renderLoadError()` still surfaces failures instead of
"No posts found." (401 from the relay says "log in again", 401/403 from Substack
says "Check your SID", 429 distinguishes the relay bucket from Substack).

**Verified 2026-10-24** with a real `substack.sid`: relay calls all `200`, three
publications (Ukiyo, Emma, Jerome Blazé), 17 posts rendered, opening the first
post loaded 1,242 characters of body HTML through `/api/v1/posts/{id}` with no
console/page errors. Guard probes (`metadata.google.internal`,
`169.254.169.254`, `localhost`, `foo.internal`, `substack.com:8080`, `/not-api`,
`/api/v1/../../x`) all `403`; `www.thefp.com` custom-domain posts `200`.

**Rollback:** `workers/rekindle-substack/worker.js` is intentionally left in the
repo, but the page no longer calls it. Deploy the function with
`npx firebase deploy --only functions:substack` (no `--force` needed while
`minInstances` stays 0).

**Not yet live:** the `substack.html` change still needs a Pages deploy. The
working tree has unrelated uncommitted work, so do not run `npm run deploy:prod`
until that is ready to ship.

### Pro gate init order (2026-10-24)

`pro-gate.js` `check()` used to invoke the page callback from the
`rekindle_pro_expiry` cache branch **before** `initFirebase()`. Pro pages whose
callback calls `firebase.auth()` / `firestore()` synchronously (Bluesky,
Mastodon) threw `Firebase: No Firebase App '[DEFAULT]' has been created` for

### Pro gate init order (2026-10-24)

`pro-gate.js` `check()` used to invoke the page callback from the
`rekindle_pro_expiry` cache branch **before** `initFirebase()`. Pro pages whose
callback calls `firebase.auth()` / `firestore()` synchronously (Bluesky,
Mastodon) threw `Firebase: No Firebase App '[DEFAULT]' has been created` for
returning Pro users and fell back to their login screen, even though the paywall
was correctly hidden. `check()` now initialises Firebase first, then takes the
cache shortcut. Repro/verification: log in, open any gated page to seed the
cache, then open Bluesky — the error disappears with the patched file. Bumped
`pro-gate.js?v=3` on all 14 gated pages.

## 📌 Pinterest connection sync (`pinterest.html`, 2026-10-24)

**Symptom:** Pinterest could be connected on a phone or PC but never on a Kindle —
tapping **Connect Pinterest** on a Paperwhite/Scribe showed a **blank screen**, and a
connection made on another device never appeared. Reported by `takinha`
(RTDB suggestions `-OxvIdfe-PjCiChFpliq`, "cant connect", 2026-07-19, 7 upvotes,
comments `samee` / `same`) and again by SRJ (2026-10-24: *"I have it on my PC but
cant open pinterest on kindle… is the pinterest login syncable?"*).

**Two independent causes:**

1. `connect()` redirects to `https://www.pinterest.com/oauth/…` — Pinterest's own
   login/consent page. The Kindle experimental browser cannot render it, so no
   `?code=` ever comes back. It presents as a blank screen, not an error.
2. The tokens were only ever written to `localStorage`
   (`pinterest_access_token` / `pinterest_refresh_token` / `pinterest_token_expiry`).
   There was no Firestore code in the page at all, so a successful login could not
   leave the device that made it.

This is **not** an API-key/client-ID limit: the client id + secret live in
`workers/rekindle-pinterest/worker.js` and are shared by every user, and Pinterest
access tokens are device-agnostic.

**Fix (same pattern as Dropbox/Bluesky):** the connection is mirrored to
`users/{uid}/pro_data/pinterest` = `{accessToken, refreshToken, expiry, updatedAt}`.
`firestore.rules` already allows that path for owner + `isProUser()`, so no rules
change was needed.

- `restoreFromCloud()` — called from `init()` when there is no local token: waits for
  auth (`awaitUser()`), reads the doc, adopts the tokens, and refreshes if they are
  within 5 minutes of expiry.
- `exchangeCode()` / `doRefresh()` → `persistLocal()` + `cloudSaveTokens()`. The
  refresh path matters because Pinterest rotates refresh tokens.
- `logout()` → also deletes the cloud doc, so **Disconnect means everywhere** (same
  as Dropbox). On an e-ink device `showEinkHint()` then explains that reconnecting
  needs a phone or computer.
- `maybeBackfillCloud()` — one-time migration for connections made before this
  change, guarded by `pinterest_cloud_stamp` so it costs at most one write per token.
- `showEinkHint()` — `isEinkBrowser()` matches `/Kindle|Silk|Kobo/` and shows a note
  on the login card instead of leaving the user at a dead-end button.

**Gotcha for future work:** `pro-gate.js` can invoke its `check()` callback **twice**
for cached Pro users — once from the cache (before auth resolves) and once from
`onAuthStateChanged`. `init()` now returns early on the second call (`this.started`),
but `restoreFromCloud()` is started by the *first* call and defers its work through
`awaitUser()`. Do not "simplify" that by reading `firebase.auth().currentUser`
directly in `restoreFromCloud()` — it is `null` at that point and the restore would
silently do nothing.

**Help text:** the "Connecting" steps in `help-data.js` now say to authorise on a
phone/computer first (`help-data.js?v=4` in `help.html`).

## ✉️ Mail: Outlook.com / Hotmail via OAuth2 device code (2026-10-26)

**Was "not supported" until 2026-10-24; now supported.** Microsoft did not
remove IMAP — it removed *Basic Authentication* (username + password, including
app passwords) for every Outlook.com protocol on **2024-09-16**. IMAP on
`outlook.office365.com:993` and SMTP on `smtp.office365.com:587` still work, but
only with OAuth2 / SASL XOAUTH2:

* <https://support.microsoft.com/en-us/support/known-issues/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-ap>
  — "September 16th, 2024: Basic Authentication no longer available to access any Outlook account."
* <https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com>
  — lists `Authentication Method: OAuth2/Modern Auth` for IMAP, POP and SMTP.
* <https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth>
  — scopes and the XOAUTH2 exchange.

### Why the sign-in happens on another device

Microsoft's sign-in is a **JavaScript app with no no-JS fallback**. Fetched with
a Kindle UA, a Chrome 120 UA and a Chrome 75 UA, `login.live.com` returns the
identical shell: **zero `<form>` elements, one `<input>`, and the text "Microsoft
account requires JavaScript to sign in"** that the bundle replaces once it boots.
`microsoft.com/devicelogin` is the same: the served page has no form at all and
`<noscript>` redirects to `login.microsoftonline.com/jsdisabled`. So the Kindle
cannot enter a device code either — the entry box is JS-rendered.

There is no protocol escape hatch: **ROPC (`grant_type=password`) is not
available for personal accounts** — "The Microsoft identity platform only
supports the ROPC grant within Microsoft Entra tenants, not personal accounts …
its parameter can't be set to `common` or `consumers`"
(<https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth-ropc>).

Therefore every Microsoft account needs **one interactive sign-in on some
browser**, once. That is not a regression: Gmail/Yahoo/iCloud already require an
app password generated on a phone/computer. Device code is the *easiest* of the
lot — no password is typed into ReKindle, it works with 2FA, and it is
revocable from the Microsoft account page.

Flow: `mail.html` shows a short code → user opens `microsoft.com/devicelogin` on
a phone/PC → `mailMicrosoftPoll` exchanges the code server-side → the refresh
token is stored and the browser only ever holds the address.

### Server side

* `firebase-functions/mail-oauth-config.js` — dependency-free constants and the
  two security-critical helpers: `endpointFor()` pins OAuth connections to
  Microsoft's hosts (a client-supplied `host` is ignored, because an access
  token is a bearer credential) and `authFor()` builds the exact auth objects
  the libraries need (`{ user, accessToken }` → ImapFlow does XOAUTH2;
  `{ type: 'OAuth2', user, accessToken }` → Nodemailer).
* `firebase-functions/index.js`:
  * `resolveMailConnection(uid, config, kind)` — the single place that turns a
    client payload into connection details. OAuth accounts → the refresh token
    for the caller's `config.accountId`; password accounts → the old
    `assertMailAuthConfig` + `assertMailEndpoint` SSRF guard. **All six mail
    callables use it** — `scripts/test-mail-oauth.js` fails if a new callable
    forgets.
  * `getMicrosoftAccessToken(uid)` — refreshes with `grant_type=refresh_token`,
    caches the access token in a module-level Map (55 min) and persists the
    rotated refresh token. `invalid_grant` / `interaction_required` deletes the
    dead token and tells the UI to reconnect.
  * `mailMicrosoftStart` / `mailMicrosoftPoll` / `mailMicrosoftStatus` /
    `mailMicrosoftDisconnect` — the device-code lifecycle. The device code lives
    in `mail_oauth_pending/{uid}` (never returned to the browser), one poll per
    `interval` (5 s), `authorization_pending` → `pending`, `slow_down` → longer
    delay, `expired_token` → `expired`, `authorization_declined` → `denied`,
    `consent_required` → `consent` (work/school tenant needs admin approval).
  * **One ReKindle user can link several Microsoft mailboxes.** Tokens live at
    `mail_oauth/{uid}/{accountId}`, the poll returns the `accountId` it used
    (reusing the existing id when the same address is relinked), `Status`
    returns `{ accounts: [{ id, email }] }`, and `Disconnect` takes an optional
    `accountId` (no id = forget every mailbox). The account *list* is owned by
    `mail.html` in `users/{uid}/pro_data/mail`; the server never writes it, so
    there is one source of truth.

### Storage, scopes, cost

* Refresh tokens: RTDB `mail_oauth/{uid}/{accountId}` (one per linked mailbox).
  There is deliberately **no rule** for it (and none for `mail_rate_limits`) —
  RTDB default-denies, the Admin SDK bypasses rules, and no client can ever read
  it. Do not add a rules block.
* Scopes: `openid profile email offline_access` plus IMAP/SMTP on **one**
  audience, chosen by `MAIL_MS_SCOPE_AUDIENCE` (`graph` by default, `outlook`
  optional) — see `mail-oauth-config.js` `microsoftScopes()`.
  `https://graph.microsoft.com/IMAP.AccessAsUser.All` and
  `https://graph.microsoft.com/SMTP.Send` are delegated Graph permissions
  (652390e4-393a-48de-9484-05f9b1212954 / 258f6531-6087-4cc4-bb90-092c5fb3ed3f)
  that personal Microsoft accounts can consent to, which is what makes a tenant
  without the Exchange SP work. Never mix the two audiences in one request —
  Entra rejects multi-resource token requests.
* Cost: one device-code setup costs ≤180 `mailMicrosoftPoll` calls (5 s × 15 min,
  once per account, ever) and each poll is one RTDB read. Polling runs with the
  Pro check only (`assertMailAccess(request, 'none')`) because the 30/5 min IMAP
  bucket would reject it. Token refresh is in-memory, so mail calls cost exactly
  what they did before.

### Setup: the Azure app registration (one-time, owner)

1. <https://entra.microsoft.com> → **App registrations** → **New registration**.
2. Name `ReKindle Mail`; supported account types **"Accounts in any
   organizational directory and personal Microsoft accounts"** (personal =
   hotmail/outlook/live).
3. Redirect URI: **leave blank** (device code needs none). Register.
4. Copy the **Application (client) ID**.
5. **Authentication** → **Allow public client flows = Yes** → Save. This is what
   enables the device-code grant. No client secret, no certificate.
6. **API permissions** → Add a permission → **Microsoft APIs** → **Microsoft
   Graph** → **Delegated permissions** → `IMAP.AccessAsUser.All` + `SMTP.Send`
   → Add. No admin consent needed (personal accounts consent at sign-in; work
   tenants may need theirs).
   **Do not hunt for "Office 365 Exchange Online" under "APIs my organization
   uses"** — a bare Entra directory has no Exchange Online service principal, so
   that API is missing from the list (the 2026-10-26 setup hit exactly this).
   Graph exposes both legacy-protocol permissions itself, so no provisioning is
   needed. If a tenant *does* show the Exchange API and you would rather use
   Thunderbird's audience, set `MAIL_MS_SCOPE_AUDIENCE=outlook`.
7. Put the ID in `firebase-functions/.env` (gitignored). Optional:
   `MAIL_MS_SCOPE_AUDIENCE=outlook` only for a tenant that has the Exchange
   service principal. Then deploy:
   `MAIL_MS_CLIENT_ID=<client-id>` → `firebase deploy --only functions`.
   Leave it unset and the callables answer `failed-precondition` ("Outlook
   sign-in is not configured yet") — the rest of Mail keeps working.

**Deploy order matters:** functions first, then Pages. `mail.html` calls
`mailMicrosoftStart`; if the page ships before the functions, the Outlook button
fails with a callable "internal" error until the deploy lands.

Probe the registration without a mailbox:

```bash
curl -s -X POST https://login.microsoftonline.com/common/oauth2/v2.0/devicecode \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=<client-id>" \
  --data-urlencode "scope=https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access"
```

A `user_code` means the registration is good; `invalid_client` means public
client flows are off (or the ID is wrong). **Do not reuse another app's client
ID** — Thunderbird's is fine for probing only.

### Multiple accounts and conversation grouping (2026-10-26)

`mail.html` keeps an **account list** rather than a single mailbox, so several
accounts — including several of the same provider — can be signed in at once:

* Stored in `localStorage` (`rekindle_mail_accounts` + `rekindle_mail_active`)
  and mirrored to `users/{uid}/pro_data/mail` as `{ accounts, activeId,
  threading }`. The old single-mailbox fields (`imapUser`, `imapPass`,
  `encrypted`, hosts, `oauth`) are deleted on the first save with
  `FieldValue.delete()`, and legacy local keys are migrated once by
  `migrateLegacyLocalAccount()`.
* Account shape: `{ id, provider, email, label, imap, smtp, passEnc }` for
  password accounts and `{ id, provider:'microsoft', email, oauth:'microsoft',
  accountId }` for Outlook. Passwords stay encrypted per account with the
  ReKindle uid (same PBKDF2 scheme as before); the decrypted copy lives only in
  memory (`account._pass`) and `serializeAccount()` drops it on every write.
* `activateAccount(id)` rebuilds `imapConfig`/`smtpConfig` from the entry, so the
  six callables and the rest of the page never needed to change. The toolbar
  shows an `Accounts (N)` button only when more than one mailbox exists.
* The Settings sheet (title-bar → Settings, `showAccountsStep()`) lists every
  mailbox with **Use** / **Remove** (Outlook shows **Sign out**, which also
  revokes the server token), plus the grouping toggle and **Add another
  account**.

**Conversation grouping is on by default** (`rekindle_mail_threading`, toggle in
the same sheet). Threads are keyed on the normalised subject — `Re:/Fwd:/AW:/…`
prefixes stripped repeatedly, whitespace collapsed — because the IMAP envelope
does not carry `References`/`In-Reply-To`, so a subject is the only signal that
works across providers; a message with no subject falls back to its own
Message-ID. `buildThreads()` runs over the loaded page, the newest message is the
row, and the badge shows the count; tapping expands the whole conversation
(newest first) in place.

Two behaviours to remember:

* With grouping on, `appendEmailRows()` **rebuilds** the list instead of
  appending, because a new page can merge into threads already on screen. With
  it off the append fast path (scroll position preserved) is still used.
* `filterEmails()` matches each row's `data-search` corpus, not `emails[index]` —
  once grouped, DOM order no longer matches the `emails` array.
* `[id$="-overlay"]` gets a forced 55% white wash in dark mode from `theme.js`
  (scrim handling, and its `:not(#gallery-flipbook-overlay)` outranks a plain id
  selector). `#auth-overlay` is a dialog, so `mail.html` re-declares it as
  `#auth-overlay#auth-overlay` to win the tie and stay opaque.

### Failure modes to keep in mind

* **IMAP off in Outlook.com.** A valid token still fails to select INBOX. The
  client's `onOutlookConnected()` says so explicitly: Settings → Mail →
  Forwarding and IMAP → "Let devices and apps use IMAP".
* **`This is not the right page` / `common/wrongplace`, and the "URL contains
  your password" warning (2026-10-26).** Both are Microsoft-side symptoms of the
  `nativeclient` redirect being mishandled on the `common` (AAD) path — the same
  failure OneDrive documents in
  <https://github.com/abraunegg/onedrive/discussions/3558>, where the fix was to
  stop relying on the nativeclient redirect. ReKindle therefore runs the device
  flow against the **`consumers`** tenant (`MAIL_MS_TENANT=consumers`), whose
  verification page is the MSA-native `microsoft.com/link` and never enters the
  AAD redirect path. Trade-off: work/school mailboxes cannot use this build.
  If a personal account still lands on `wrongplace`, the remaining option is to
  replace the nativeclient redirect with a real HTTPS redirect URI on the app
  registration (the browser then lands on a page that exists).
* **`invalid_request: The provided request must include a 'redirect_uri' input
  parameter` on Microsoft's page (2026-10-26).** The app registration has no
  redirect URI, and Microsoft's device sign-in wants one even though the device
  flow never uses it — `allowPublicClient` alone is not enough. Fix:
  Authentication → **Add a platform** → **Mobile and desktop applications** →
  tick `https://login.microsoftonline.com/common/oauth2/nativeclient` →
  Configure. The device code from the failed attempt stays dead, so press
  Connect again. `mail.html`'s "Problems signing in?" link in the code panel
  spells this out, because the Kindle cannot show Microsoft's error page.
* **`invalid_grant` on refresh** (user revoked access, password change, 90 days
  unused) → token deleted, UI asks to reconnect. `isUserProCached` is unaffected.
* **Work/school mailbox** → `consent_required` until the tenant admin approves
  the app; surfaced as "Your organisation needs to approve this app".
* **Unverified publisher / "Publisher verification" banner.** The portal warns
  "end users cannot grant consent to newly registered multitenant apps without
  verified publishers". That policy is *risk-based step-up consent*, enforced by
  the **user's** tenant for users in tenants other than the app's own, on apps
  registered after 2020-11-08 that ask for more than basic sign-in. Personal
  Microsoft accounts live in the consumer tenant and get the ordinary
  "unverified publisher" consent screen, which still allows consent — so
  Hotmail/Outlook.com sign-in is **not** blocked by it. It *does* affect
  work/school users in other organisations: they either need their admin to
  grant admin consent (which bypasses user consent) or the app needs publisher
  verification. If a personal account is ever blocked, switch Supported account
  types to **"Personal Microsoft accounts only"** (and set
  `MAIL_MS_TENANT=consumers`) to leave the multitenant policy behind entirely.
  Publisher verification itself is not quick: it needs a verified Partner
  Center (CPP/MPN) account, a DNS-verified non-`onmicrosoft.com` publisher
  domain, a *work* account (an MSA-registered app can't be verified), the
  Application Administrator role and MFA.
* **`isMicrosoftMailHost()` in `mail.html` is still needed.** It stops someone
  pasting `outlook.office365.com` into **Custom (IMAP)** and expecting a
  password to work; the notice now points them at the Outlook button.

### The forwarding fallback (still valid for users who refuse a second device)

Outlook.com → Settings → Mail → Forwarding to a Gmail address, then Gmail →
"Send mail as" the Hotmail alias. Receive and send both work as
`you@hotmail.com`; old mail and folders stay invisible in Mail.
