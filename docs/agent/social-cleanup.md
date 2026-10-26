# Daily Social Cleanup (`cleanupSocial`)

Area notes for the scheduled retention job added 2026-10-21. Read before changing
`firebase-functions/social-cleanup.js`, `firebase-functions/cleanup-lib.js`, the social
RTDB rules, or anything that relies on old social content still existing.

## What it is

A Firebase v2 scheduled function in the **primary** project (`rekindle-dd1fa`) that
runs once a day at **04:00 Australia/Sydney** and prunes expired content owned by
the **social** project (`rekindle-socials`), plus the primary-project `mod_actions`
audit log. It uses the existing `socialAdminApp` (secondary app initialized from
`SOCIAL_SERVICE_ACCOUNT_JSON` in `firebase-functions/.env`), so no new secret is
needed.

Why a Firebase Function and not a Cloudflare Worker: the Admin SDK already provides
`recursiveDelete`, aggregation `count()`, Firestore transactions and the social
service-account wiring. A Worker would need hand-rolled Firestore batch REST and
OAuth token minting for the same Firebase read/delete bill. One Cloud Scheduler job
and one daily invocation fit the free tiers.

## Retention

| Data | Project / path | Kept | Action |
| :--- | :--- | :--- | :--- |
| Chat messages | Social RTDB `kindlechat/messages/{id}` | 30 d, plus the latest 50 | Delete |
| Chat translations | Social RTDB `kindlechat/translations_by_lang/{lang}/{id}` | same as message | Delete in the same multi-path update |
| Art index | Social RTDB `kindlechat/art_index/{id}` | same as message | Delete in the same multi-path update |
| Topic comments | Social Firestore `topics/{id}/comments/{commentId}` | 90 d | Batched deletes, then repair `commentCount`/`lastActive` |
| Empty topics | Social Firestore `topics/{id}` + `pollVotes` | 90 d old and no comments | `recursiveDelete` |
| Neighbourhood posts | Social Firestore `neighbourhood_posts/{id}` + `comments` | 90 d | `recursiveDelete` |
| Reports | Social RTDB `reports/{id}` | 90 d old, resolved/dismissed only | Delete |
| Automod log | Social RTDB `automod_log/{id}` | 30 d | Delete |
| Moderator actions | Primary RTDB `mod_actions/{id}` | 365 d | Delete |

Never deleted: **pending reports**, DM threads/messages (`kindlechat/dm_*`),
`users_public`, `user_cards`, `users_private`, `timeouts`, `banned_ips`,
`suggestions`, and all personal user data.

Art-gallery consequence: `art_index` entries are deleted with their messages. The
gallery already handles missing messages, so it prunes instead of showing broken
items. Preserving old art would require storing the full art in `art_index` (it only
holds thumbnails today), which is a separate design change.

## Config

All cutoffs and caps live in `CLEANUP_CONFIG` in
`firebase-functions/social-cleanup.js`. Change the constants and redeploy; there is no
remote config document.

| Key | Default |
| :--- | :--- |
| `chatRetentionDays` | 30 |
| `keepLatestChatMessages` | 50 |
| `topicRetentionDays` | 90 |
| `neighbourhoodRetentionDays` | 90 |
| `reportRetentionDays` | 90 |
| `automodRetentionDays` | 30 |
| `modActionsRetentionDays` | 365 |
| `chatBatchSize` | 200 messages per multi-path write |
| `keyPageSize` | 1000 keys per shallow RTDB page |
| `firestorePageSize` | 200 topics per page |
| `deleteBatchSize` | 400 comment deletes per Firestore batch |
| `maxTopicsPerRun` | 500 |
| `maxChatMessagesPerRun` | 25000 (RTDB deletes do not consume Firestore write quota; the 8-min budget is the stop) |
| `maxCommentDeletesPerRun` | 4000 |
| `maxPostDeletesPerRun` | 100 |
| `maxReportDeletesPerRun` | 5000 |
| `maxAutomodDeletesPerRun` | 5000 |
| `maxModActionDeletesPerRun` | 5000 |
| `timeBudgetMs` | 480000 (8 min; the function timeout is 540 s) |

The Firestore caps are sized for the **social project staying on the Spark/free
tier** (20k document writes/day). Post deletes also consume one write per attached
comment, so `maxPostDeletesPerRun` is deliberately lower than the topic-comment cap.
The 04:00 Australia/Sydney schedule lands after the midnight-Pacific quota reset. If
the social project is upgraded to Blaze, these caps can be raised (deletes cost about
$0.18 per 100k writes).

`dryRun` is enabled by setting `SOCIAL_CLEANUP_DRY_RUN=1` in
`firebase-functions/.env` and redeploying. It performs all reads and logs the
candidates but no deletes, batches, transactions or recursive deletes.

## How each task stays cheap

- **Chat:** pages the `kindlechat/messages` keys with shallow `limitToFirst` +
  `startAfter` (keys only, 1000 per page) and decodes each Firebase push-ID timestamp
  to decide age; paging stops at the first key newer than the cutoff. RTDB rejects
  `orderBy`/`endAt`/`startAt` on shallow GETs, which is why the age comes from the
  push ID instead of a filtered query. The latest 50 messages are fetched with one
  `orderBy="timestamp"&limitToLast=50` query (full payloads for those 50 only) so a
  dormant room keeps a visible tail. One multi-path `update()` deletes the message
  plus `art_index` and every language translation. The live language list is read
  shallow from `translations_by_lang`; the hard-coded `TRANSLATION_LANGS` list is only
  a fallback.
- **Topics:** scan only topics whose `timestamp` is already older than the retention
  window, page their comments by `timestamp`, delete 400 per batch, then use
  `count()` (an aggregation) and one `orderBy('timestamp', 'desc').limit(1)` read to
  repair the denormalised counter and `lastActive`. Counter updates use a transaction
  so a comment posted during cleanup is not lost. A topic that loses all comments is
  removed with `recursiveDelete`, which also clears `pollVotes`.
- **Neighbourhood:** one query for old posts (selecting only `timestamp`), then
  `recursiveDelete` per post. This removes the whole comment subcollection without
  reading comment bodies; Firestore's list/delete operations replace per-comment
  reads.
- **Reports / automod / mod actions:** reports use the normal ordered query because
  the `status` field is needed (the existing `createdAt` index covers it). Automod and
  moderator actions page shallow keys and use the push-ID timestamp. `mod_actions`
  keys are often client-created, so each candidate's stored `createdAt` is verified
  with one single-field GET before deletion; that avoids a skewed device clock
  deleting a recent action and never downloads `savedData`.
  Pending reports are skipped. If the oldest report page is entirely pending, the task
  stops rather than re-reading it every day.
- **Bounded work:** every task checks the 8-minute budget and per-run caps. A large
  first backlog is deleted oldest-first over several days. Firestore
  `RESOURCE_EXHAUSTED` is treated as a temporary quota limit: the task stops early,
  logs `quotaExceeded`, and does **not** fail the scheduler invocation; the next daily
  run resumes. Real errors still fail the invocation.

## Index requirements

No new RTDB or Firestore indexes are required. The only ordered RTDB query left is
the reports scan, which uses the existing `reports` `.indexOn` in
`rtdb-social-rules.json` (`createdAt` is already listed). The chat/automod/mod-action
scans use shallow key pages, so they never need an `orderBy` index.

Firestore queries filter and order by the same single field (`timestamp`) inside one
collection/subcollection, which uses the automatic single-field index.

## Deploy and first run

No rules deploy is required for this job (it uses the service account and the
existing reports index). If the earlier build already added the experimental
`automod_log` / `mod_actions` indexes, they are harmless and can stay until the next
rules deploy.

```bash
# 1. Deploy in dry-run mode.
#    Add SOCIAL_CLEANUP_DRY_RUN=1 to firebase-functions/.env first.
firebase deploy --only functions:cleanupSocial --project rekindle-dd1fa

# 2. Run the Cloud Scheduler job manually and inspect the logs:
#    Console -> Cloud Scheduler -> firebase-schedule-cleanupSocial-us-central1 -> Run now
#    Expect "social-cleanup: starting/finished", dryRun=true, and candidate counts.

# 3. Remove SOCIAL_CLEANUP_DRY_RUN from firebase-functions/.env and redeploy.
firebase deploy --only functions:cleanupSocial --project rekindle-dd1fa
```

The function name is `cleanupSocial`; the auto-created scheduler job is
`firebase-schedule-cleanupSocial-us-central1`. A scheduled run requires the Blaze plan
and the Cloud Scheduler API (already enabled by the existing v2 functions).

If any task fails, `runSocialCleanup` still runs the remaining tasks and the exported
handler throws at the end so Cloud Monitoring shows the invocation as failed. Check
the per-task error in the logs.

## Verification

1. Dry run: candidate counts are non-zero, `"dryRun": true`, and a known old message
   still exists.
2. First real run: the log shows `dryRun=false`; spot-check that one old message, one
   old topic comment/post, one resolved old report and one old automod entry are gone
   while recent counterparts remain.
3. Topic counters: open a cleaned topic and confirm the sidebar count and relative
   `lastActive` match the remaining comments.
4. Run again the next day: deletion counts should be near zero (idempotent).
5. KindleChat, Topics and Neighbourhood still load; removed nodes only arrive as
   listener removals, which all three clients already handle.

## Edge cases / failure modes

- **Missing timestamps** are excluded by `startAt=0` in RTDB and by Firestore range
  filters. Malformed legacy documents are therefore never deleted by this job.
- **Invalid RTDB keys** (slashes/dots) are filtered before paths are built, so a bad
  key cannot escape the intended subtree.
- **Token failure** skips that RTDB task and logs it; Firestore tasks still run.
  **Missing `SOCIAL_SERVICE_ACCOUNT_JSON`** fails the scheduled invocation visibly.
- **Concurrent activity:** topic counters use a transaction; post/comment deletion
  uses an old cutoff (90 d), so races are negligible.
- **Old pending reports** can block the oldest report page; the task stops and logs
  rather than looping. Resolve/dismiss them in the moderation console.
- **Art/translations for already-deleted messages** are not discovered by this job.
  They need a one-time orphan sweep.
- **Deleting old `mod_actions`** removes their undo data after 12 months.

## Deliberately not cleaned

- `kindlechat/server_rate_limits` — small; revisit if the user base grows.
- `kindlechat/user_recent` — retired stale node; one-time manual delete.
- Orphaned `translations_by_lang` / `art_index` entries from before this job.
- `matchmaking/*` and `games/*` — no reliable server-side age field yet; add a
  `createdAt` at host time first.
- `freewrite_sessions` (primary RTDB) — separate feature; could get its own short
  retention later.
- DM messages — deliberately untouched.

## 2026-10-21: shallow GET rejected `orderBy`/`endAt`

The first deployed run logged `RTDB query failed (400)` for **chat**, **automod** and
**mod actions**. RTDB shallow GETs only support `limitToFirst` (plus key cursors such
as `startAfter`); they reject `orderBy`, `startAt`, `endAt` and `limitToLast`:

```
shallow+orderBy+startAt+endAt => 400 { "error" : "startAt not supported for with shallow GET, use startAfter" }
shallow+orderBy+endAt        => 400 { "error" : "endAt not supported for with shallow GET, use limitToFirst" }
shallow+orderBy              => 400 { "error" : "orderBy not supported for with shallow GET, keys are returned in lexicographical order" }
```

The fix pages shallow keys (which are already lexicographic/push-ID-chronological) and
decodes the first 8 characters of each push ID as the creation time. Do **not** add
`orderBy` to a shallow GET again. Reports still use a normal ordered query because it
needs the `status` field and already has the `createdAt` index.

## 2026-10-21: social Firestore free-tier quota

The first real run (10,347 topic comments + 1,000 neighbourhood posts + 157 topics)
consumed the social project's daily Firestore write quota. The next run failed its
topics and neighbourhood tasks with:

```
8 RESOURCE_EXHAUSTED: Quota exceeded.
```

The chat/reports/automod/mod-action tasks were unaffected because they use RTDB, which
is not subject to the Firestore write quota. The social project is on the Spark/free
tier (20k writes/day), so the caps were lowered to 4,000 topic comments / 100 posts /
500 topics per run, and `RESOURCE_EXHAUSTED` is now logged as `quotaExceeded` without
failing the scheduler invocation. The next daily run resumes after the quota resets at
midnight Pacific Time. If this becomes a recurring problem, upgrading
`rekindle-socials` to Blaze removes the cap for a few cents of delete charges.

## 2026-10-25: chat backlog and the 25k/run cap

`kindlechat/messages` held **1,070,698 keys** (a 29.98 MB shallow listing) because
retention only started on 2026-10-21. At the old 5,000 messages/run the backlog alone
would take ~7 months to prune, and every cleanup run pages the whole node. Raised
`maxChatMessagesPerRun` to **25,000**: chat deletes are RTDB operations, not Firestore
writes, so they do not compete with the 20k/day social write quota; the 8-minute budget
still stops a slow run. Expected backlog clearance ~6 weeks.

Watch the first runs in Cloud Logging: `"task":"chat"` should show `deleted` near 25,000
and `truncated:true` when the cap (not the cutoff) stopped it. If `deleted` is far below
25,000 because the time budget expired, lower the cap rather than the budget.

## 2026-10-26: the pending-report backlog blocks report retention

Measured on the social RTDB: `/reports` held **17,406 entries, 16,150 of them pending**,
spanning 2026-06-12 → 2026-10-26. Two consequences:

* Most pending entries are chat/DM reports whose content the chat retention (or the
  reporter's own later deletion) already removed, so `autoDeleteContent()` fails and the
  report can never auto-resolve. They are effectively tombstones.
* `cleanupReports()` pages keys oldest-first and stops as soon as the oldest 500-key page
  is entirely pending (the documented 2026-10-21 behaviour). With a backlog this large the
  first page is all pending, so **resolved reports older than 90 days are never pruned** —
  the task exits on its first page every day.

The moderation console no longer depends on the backlog: it queries
`orderByChild('status').equalTo(...)` + `limitToLast(N)` instead of downloading `/reports`
(see moderation-reports.md). If the stale pending entries should be cleared, the durable
fix is a cleanup pass that resolves pending reports whose `contentType` is a
single-report type and whose `contentPath` no longer exists — not a console change.

## Tests

`node scripts/test-cleanup.js` (also part of `npm test`) covers cutoff arithmetic,
push-ID timestamp decoding, key/path safety, quota-error classification, multi-path
construction, report-status rules, timestamp coercion, and the concurrency helper. The
I/O layer is verified in production with the dry-run rollout above.
