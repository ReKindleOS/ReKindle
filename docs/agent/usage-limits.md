# Firebase & Cloudflare usage limits (2026-10-25 audit)

Measured with Cloud Monitoring and the Cloudflare GraphQL analytics API, not with the
Firebase/Cloudflare dashboards. Read this before changing collection sizes, listener
windows, scheduled jobs, or Pages Functions.

## Plans (authoritative)

| Project | Plan | Consequence |
| :--- | :--- | :--- |
| `rekindle-dd1fa` (main) | **Blaze** (`billingEnabled: true`, billing account `015AA1-7183A1-7B40DF`) | No hard daily caps; cost per operation. Firestore reads/writes are a few dollars/month. |
| `rekindle-socials` | **Spark** (`billingEnabled: false`) | 50k Firestore reads/day, 20k writes/day, 20k deletes/day, 1 GiB stored, 10 GiB/month egress. RTDB: 100 concurrent connections, 1 GiB stored, 10 GiB/month downloaded. |

Both Firestore databases are `FIRESTORE_NATIVE` in `australia-southeast1`.
`rekindle-socials` has exactly one database (`(default)`), so the free-tier quota applies
to every social read.

## Measured usage at 2026-10-25 06:00 UTC

### Firestore — social (Spark)

| Metric | 7-day average | Peak | Free allowance | Status |
| :--- | ---: | ---: | ---: | :--- |
| Document reads | 217,244/day | 298,829 (Oct 5) | **50,000/day** | **4.3x over** (6x at peak) |
| Document writes | 2,691/day | 5,696 (Oct 5) | 20,000/day | 29% |
| Document deletes | 2,504/day | 17,481 (Oct 22) | 20,000/day | 87% on Oct 22 (cleanup backlog) |
| Stored data | — | 356.8 MB | 1 GiB | 35% |

The social project produced only ~2k Firestore API calls/day but 217k document reads —
queries return many documents. **`topics.html` was the dominant source:** a
`limit(200)` sidebar listener ran on every `/topics` load (~600-1,000 loads/day), i.e.
~120k-200k reads/day on its own. The next largest are the neighbourhood feed
(`limit(10)`), open comment lists (`limit(100)` per post, billed per actual comment),
and `moderation.html` (bulk posts/topics/comments for moderators).

No `RESOURCE_EXHAUSTED` entries appear in Cloud Logging for social Firestore reads over
the last 30 days, but the **write** quota did fire on 2026-10-21 (see
[social-cleanup.md](social-cleanup.md#2026-10-21-social-firestore-free-tier-quota)), so
the project is genuinely on Spark and the write/delete caps are real. Treat the read
figure as a cap that can start failing without warning. Upgrading `rekindle-socials` to
Blaze costs about **$3/month** at the current 217k reads/day (≈5M billable reads after
the 50k/day free allowance); that is the decisive fix if social must keep reading well
above 50k docs/day. The 60-topic change below is the free-tier alternative.

**2026-10-25 change:** `topics.html` now loads the 60 most recently active topics and
offers a "Show all topics" button (500 docs, on demand, 5-minute cache) plus the
existing search fetch. At the measured ~600 `/topics` loads/day that removes ~84k
reads/day: **~217k → ~133k/day (−39%)**. If the real load count is closer to 1,000/day
the saving is ~140k/day (−64%); the metrics only give the total, not per-page loads, so
verify the drop over 2-3 days. The button and search still reach older topics;
`selectTopic()` already fell back to a single-doc `get()` for topics outside the live
window. The remaining non-topics reads (~97k/day) are neighbourhood feeds, open comment
lists, the moderation export (N+1 comment queries) and `cleanupSocial`; add per-page
counters before trimming those.

### Firestore — main (Blaze)

| Metric | 7-day average | Peak |
| :--- | ---: | ---: |
| Document reads | 55,089/day | 248,834 (Oct 20, audit/backfill day) |
| Document writes | 22,547/day | 28,091 (Oct 22) |
| Document deletes | 497/day | 1,114 |
| Rules evaluations | 123,966/day | 134,420 |
| Stored data | — | 1.483 GB |

Blaze includes the Spark no-cost usage per project, so only the overage bills: reads are
~5k/day over the 50k free (≈$0.09/month), writes ~2.5k/day over the 20k free
(≈$0.14/month), and 0.48 GB over the 1 GiB free (≈$0.09/month). **≈$0.30/month total.**
Not a limit or cost risk; optimise only if latency or a specific page's read count
regresses.

### Realtime Database — social (Spark)

| Metric | Value | Free allowance | Status |
| :--- | ---: | ---: | :--- |
| Trailing-30-day download (`monthly_sent`) | **9.26 GB** | **10.74 GB** (10 GiB) | **86%**, +0.35-0.45 GB/day |
| Stored bytes | 738.5 MB | 1 GiB | **69%** |
| Concurrent connections | 24 max | 100 | 24% |
| `kindlechat/messages` keys | **1,070,698** | — | 29.98 MB shallow listing |

`monthly_sent` is a rolling 30-day counter, not a calendar-month total: it rises with each
day and drops when a 30-day-old day rolls off (e.g. Oct 3 −24.5 GB when the 5.4 GB Sep 3
spike aged out). At the current ~0.4 GB/day it crosses 10.74 GB around **Oct 29-30** and
stays above it until the high-usage late-October days roll off in late November.

The 1.07M-key message node is the backlog from before retention existed (added
2026-10-21). A bare-node or full-message read is what produced the 5.4 GB Sep 3 and
0.71 GB Oct 20 days. `maxChatMessagesPerRun` was raised from 5,000 to 25,000 on
2026-10-25 (RTDB deletes do not consume the Firestore write quota; the 8-minute budget
still stops a slow run), so the backlog should clear in ~6 weeks instead of ~7 months.
That also keeps storage under the 1 GiB line.

Do **not** use `sent_payload_bytes_count` for billing estimates: it sums to roughly 3x
the `monthly_sent` gauge on this database. Use the `monthly_sent` day-over-day delta.

**2026-10-25 change:** the KindleChat per-language translation listener is now
`orderByKey().startAt(oldestGeneralKey).limitToLast(200)` (it was unbounded above the
start key). In a dormant room the oldest rendered message can be months old, so the old
query still synced every translation since then — potentially the whole 25k-entry node
on a page load. The 200-key window always covers the 50 rendered messages; paginated
messages keep fetching translations individually. Check the `monthly_sent` day-over-day
delta for a few days to confirm the reduction.

### Realtime Database — main (Blaze)

`monthly_sent` 10.79 GB trailing (limit unlimited), storage 104 MB, peak 81 concurrent
connections. No limit risk. Blaze includes the Spark 10 GB/month download allowance, so
the overage is ~0.8 GB ≈ **$0.79/month**; not worth optimising for cost alone.

### Cloud Functions (main project, Blaze)

30-day invocations:

| Function | Invocations |
| :--- | ---: |
| `getSocialToken` | 126,495 |
| `akinator` | 103,776 (function removed 2026-10-21; historical points only) |
| `checkIPOnLogin` | 9,711 |
| `createRssFeed` | 1,113 |
| mail (`getFolders`/`fetchEmails`/…) | < 150 each |
| `cleanupSocial` | 7 (daily schedule) |

Free tier is 2,000,000 invocations/month, so the live project is at ~6% excluding the
removed Akinator function. `getSocialToken` is the top live call (every social page load
called it before `signInWithCustomToken`).

**2026-10-25 change:** the seven social pages now call
`window.rekindleEnsureSocialAuth(auth, socialAuth)` from
[js/social-token-cache.js](../../js/social-token-cache.js) instead of the callable
directly. It caches the social custom token in `sessionStorage` for 50 minutes, keyed by
the main uid, and reuses the restored Firebase Auth session when the token is fresh. A
social session that was wiped (Kindle cache cleanup/new tab) signs in with the cached
token, which is one Auth request instead of a Function invocation. Claims
(pro/moderator/ageVerified) can be up to 50 minutes stale; do not extend the TTL without
accepting that. `scripts/test-social-token.js` covers the cache/mismatch/expiry paths.
Expected: most same-tab page navigations make zero `getSocialToken` calls; roughly an
80% reduction for multi-page sessions, less for users who open a new tab per page.

### Cloudflare Workers & Pages

Daily requests, all scripts + Pages Functions (Cloudflare GraphQL, account-wide):

| Date | Pages Functions | Workers | Total |
| :--- | ---: | ---: | ---: |
| Oct 21 | 1,940 | 32,030 | 33,970 |
| **Oct 22** | **95,960** | 26,100 | **122,060** |
| **Oct 23** | **101,070** | 21,580 | **122,650** |
| **Oct 24** | **92,880** | 28,300 | **121,180** |
| Oct 25 (partial) | 60,520 | 25,350 | 85,870 |

The jump is **not traffic**: zone requests were flat/lower on Oct 22-24. It is
`functions/_middleware.js`, added on Oct 22 (commit `5a1ebe8`) to map
`repo.rekindle.ink` to the KPM manifest. Pages runs middleware for **every** request to
the project, so a host that gets ~1k requests/day added ~95k Function invocations/day.
The file was deleted on 2026-10-25. The short repo URL is now served by the tiny
`rekindle-kpm` Worker route (`workers/rekindle-kpm/`, `repo.rekindle.ink/*`, deployed
2026-10-25), which fetches the static manifest/package from
`https://rekindle.ink/downloads/kpm/`. Pages `_redirects` cannot do this (domain-level
rules are unsupported), and a Pages Function would run for the whole site again.
Expected: back to ~2k Pages Functions/day, ~25k total/day, plus ~1k/day on the repo
Worker.

Worker requests over 30 days: `rekindle-translate` 1,226,140 (peak 62,320/day),
`rekindle-moderate` 619,270 (peak 30,790/day), `rekindle-reader` 11,620, `chords` 8,140,
`rekindle-stripe` 4,280, `rekindle-tmdb` 1,960, `story` 1,950, `rekindle-substack` 320,
`rekindle-oracle` 190, `rekindle-readwise` 90, `rekindle-pinterest` 60,
`rekindle-ocr` 30.

`rekindle-translate` also logged **18,550 errors** in 30 days, nearly all
`exceededResources` (CPU limit) plus `clientDisconnected`; the client retries missing
languages up to 4 times, which inflates request count. It is the first Worker to look at
if the account is on the free 100k/day allowance.

**2026-10-25 change:** the translation Worker now caches results in the Cloudflare Cache
API for 7 days, keyed by a SHA-256 of the exact text:

- a full translation map for the normal auto-detect request (one cache hit replaces the
  detect call plus nine Google calls);
- per-language values for retry requests (`missingLangs`), keyed by
  `targetLang + sourceLang` so a client-supplied `knownSourceLang` cannot poison the
  shared map;
- the detection result, but only when Google actually answered (a failed detection is
  never cached, otherwise non-English text would be marked English for a week).

Cache hits skip the 75 ms stagger and the Google fetches, so common repeated phrases
("hello", "hi", "lol") do much less CPU and stop generating 429s → fewer client retries.
It does **not** reduce the one-call-per-message base rate (each message still needs its
own RTDB writes); batching would require the client to queue messages, which was not
done. Deploy with `cd workers/rekindle-translate && npx wrangler deploy`, then watch
`execution_count` errors and the client-side retry volume for a day.

Free Workers allowance is **100,000 requests/day account-wide**. Oct 22-24 exceeded it if
this account is on Free. The analytics show zero Pages errors, and `usageModel` is
`standard` for every script, which is consistent with either Free or a paid account using
the bundled model — confirm the plan in the dashboard before assuming the overage failed
requests. After the middleware removal the account has ~75k/day of headroom either way.

KV (story): 4,020 reads / 3,540 writes / 420 deletes per 30 days — negligible against
100k reads/day and 1k writes/day. No D1, R2, or AI usage of note.

### Noise that inflates the numbers

- A scanner/bot sends `User-Agent: nginx-ssl early hints` and gets **207,907 504s on `/`**
  in 7 days (~30k/day) from BR/US/ES/GB. It does not reach Pages Functions after the
  middleware removal, but it pollutes zone analytics and response codes.
- The Kindle UA `(X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+` is both a
  real client and a common scraper UA; a single Brazilian network produced 262k requests
  in 3 days. Blocking the `early hints` UA with a WAF custom rule is safe and cheap
  (needs firewall write access, not currently in the wrangler OAuth token).

## Deploying the 2026-10-25 changes

These are source changes; production still runs the old code until each is deployed.

1. **Pages:** `npm run deploy:prod` (the build has passed; `_deploy/main` has no
   `functions/_middleware.js`). This ships the middleware removal, the 60-topic
   sidebar, the translation-listener bound and `js/social-token-cache.js`. Beta:
   `npm run deploy:beta`.
2. **Cleanup function:** `firebase deploy --only functions:cleanupSocial --project
   rekindle-dd1fa`.
3. **KPM Worker:** already deployed with `cd workers/rekindle-kpm && npx wrangler
   deploy` (route `repo.rekindle.ink/*`). Re-deploy only if the Worker source changes.
4. **Translation Worker:** already deployed on 2026-10-25
   (`cd workers/rekindle-translate && npx wrangler deploy`; smoke test: an
   unauthenticated POST returns 401 with the `rekindle.ink` CORS header).

After a day, re-check `pagesFunctionsInvocationsAdaptiveGroups` (expect ~2k/day),
social `document/read_count` (expect ~130k/day or lower), social `monthly_sent`
(expect the ~0.4 GB/day slope to flatten).

## How to re-measure

Cloud Monitoring (OAuth token from `~/.config/configstore/firebase-tools.json`; the
Firebase CLI login has `cloud-platform` scope):

```
GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries
  ?filter=metric.type="firestore.googleapis.com/document/read_count"
  &interval.startTime=...&interval.endTime=...
  &aggregation.alignmentPeriod=86400s
  &aggregation.perSeriesAligner=ALIGN_SUM
  &aggregation.crossSeriesReducer=REDUCE_SUM
```

Useful metric types:

- Firestore: `document/read_count`, `document/write_count`, `document/delete_count`,
  `api/request_count`, `storage/data_and_index_storage_bytes`. `read_count` has
  separate `type` labels (`LOOKUP` for single-doc gets, `QUERY` for queries); sum
  both, they are distinct billed operations, not duplicates.
- Social RTDB: `firebasedatabase.googleapis.com/network/monthly_sent`,
  `network/monthly_sent_limit`, `storage/total_bytes`,
  `network/active_connections`, `network/https_requests_count`.
- Functions: `cloudfunctions.googleapis.com/function/execution_count` (group by the
  `function_name` **resource** label).
- Quota limits: `serviceruntime.googleapis.com/quota/limit`, filtered to
  `metric.labels.quota_metric` (`firestore.googleapis.com/read_operations_per_project`
  is 50,000 on social).

Cloudflare: POST to `https://api.cloudflare.com/client/v4/graphql` with the wrangler OAuth
token. Datasets: `pagesFunctionsInvocationsAdaptiveGroups` (dimensions `scriptName`,
`date`, `status`), `workersInvocationsAdaptive` (`scriptName`, `date`),
`workersSubrequestsAdaptiveGroups`, `kvOperationsAdaptiveGroups`. Account ID is
`264c1185a9930ff6d69502c0c9c6bfd7`.
