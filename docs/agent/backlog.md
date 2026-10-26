# Deferred optimisation & QoL backlog — 2026-10-20

> **ReKindle+ 2026-10-26 follow-ups:** the app-wide touch/design pass, window-width map,
> 48 px evidence, per-app order and the remaining Mail/social/OAuth/CSP work now live in
> [`docs/audits/rekindle-plus-followups-2026-10-26.md`](../audits/rekindle-plus-followups-2026-10-26.md).
> Bluesky full i18n shipped in the same release; do not re-open it as a backlog item.

Everything flagged by the [2026-10-20 audit](audit-2026-10-20.md) that was **not** attempted in
the fix pass, plus the places where a fix was deliberately partial. Each entry has the evidence
needed to start without re-doing the investigation.

The audits were static (line-cited code review + `npm test` + a production build). Nothing here
has been verified on a Kindle or an e-ink panel — that is part of the work.

**Order:** P1 = user-visible or correctness risk; P2 = measurable slowdown on the target device;
P3 = maintainability. `risk` is the chance the change breaks something a test cannot catch.


## Status 2026-10-21 (backlog pass)

**Shipped:** BL-02, BL-03, BL-04, BL-05, BL-06, BL-07, BL-08, BL-11, BL-12, BL-13, BL-14, BL-15,
BL-16, BL-17, BL-18, BL-19, BL-20, BL-24, BL-26 (stale service workers deleted), BL-28 (presence
poll, topics `docChanges`, badge auth gating, repo-wide emoji sweep).
Details are recorded in the matching `docs/agent/*.md`.

**Still open (deliberately):**

| ID | Why it is still open |
|---|---|
| BL-01 | Checked and **not applicable** — see the corrected entry below |
| BL-09 (rest) | 9 forced `getIdToken(true)` calls remain (background translations + three one-off pages) — see BL-09 |
| BL-10 | Reader chapter-mounting is a rewrite of pagination + resume; needs device testing |
| BL-21 | 130+ page edits with differing modal behaviour; needs a visual QA pass |
| BL-22 | Same: a shared stylesheet changes every page's layout |
| BL-23 | Pruning needs per-namespace review; added `npm run locales:report` instead |
| BL-25 | `index_old.html` still needs the shared-dashboard extraction; the Lite build must be exercised |
| BL-26 (pages) | `manga.html` / `texasholdem.html` need a product decision (register or delete) |
| BL-27 (mail) | Stripe caches and the supporters field mask shipped; the mail callables still run serially because `loadEmails` depends on `loadFolders` setting `currentFolder` |
| BL-28 (rest) | Poll votes are still read as a whole collection; the Multiplayer tab duplicates the matchmaking query; `moderation.html` has no `data-i18n` attributes, so i18n alone would be a no-op and `theme.js` would change an admin layout never built for zoom |

---

## Security re-audit 2026-10-24 (Dependabot + code scanning)

**Fixed — GHSA-27r3-jxmh-p828** (`body-parser` DoS via trailing bytes after a compressed body):
`firebase-functions/package-lock.json` 2.3.0 → 2.4.0 and `akinator-service/package-lock.json`
1.20.8 → 1.20.9 (plain `npm audit fix`; no manifest changes). `npm audit` reports **0** in the
root, `firebase-functions/`, `akinator-service/` and `workers/rekindle-reader/`.
**Deploy note:** CI only publishes Cloudflare Pages, so the Functions package needs a manual
`firebase deploy --only functions`; the Akinator relay needs a Northflank rebuild
(`akinator-service/` Dockerfile runs `npm ci`).

**Fixed — CodeQL:**
* `js/bad-tag-filter` `build-automation.js:485` — the inline `<script>` matcher now uses
  `</script[^>]*>`, so every end tag a browser accepts (`</script >`, `</script\t\n bar>`) is
  rewritten, not just `</script>`.
* `js/incomplete-sanitization` `scripts/test-kindle.js:50` — the version regex escapes every
  metacharacter, not only dots, so a version like `1.2.3+build(4)` cannot change the pattern.
* `js/incomplete-multi-character-sanitization` `akinator-service/akinator.js` (`parseQuestion`,
  `parseAnswerLabels`) — new `stripHtmlTags()` repeats tag removal until stable and escapes any
  leftover `<`, so nested markup (`<<script>script>`) cannot leave `<script` behind. Entities are
  still left for the client's `decodeHtml()`; `scripts/test-akinator.js` covers the nested case
  and a lone `<`.

**Accepted — 3 × `js/clear-text-storage-of-sensitive-data`** (`time.js:491`,
`settings.html:988`, `settings.html:994`), dismissed "won't fix" on 2026-10-24 with the same
rationale as #182: the blob is the user's chosen timezone city (name, lat/lon, UTC offset) in
same-origin `localStorage`, with no credentials or cross-user data. `time.js`, `theme.js`,
`js/i18n.js`, `index.html`, `weather.html` and `maps.html` all require plain JSON — the old
base64-XOR storage broke them — so obfuscating it is not an option. Do not "fix" this by
re-encrypting the value without updating every reader.

---

## P1 — correctness / user-visible

### BL-01 · NOT APPLICABLE — the Lite dashboard has no live-lobby UI
- **Checked 2026-10-21:** `grep -c "matchmaking\|liveGames\|live-games" index_old.html` → 0. Its
  `LIVE` labels come from the static `app.live` metadata flag (it means "this app supports live
  play"), not from `matchmaking` listings. There is nothing to validate or clean up.
- **What is actually true:** the Lite/Legacy build has no live-games section at all. Adding one is
  a feature, not a fix; if that is wanted, port `validateLiveMatch` + the badge listener + the tab
  together.
- **Original audit claim was wrong** — it inferred a listing UI that does not exist.

### BL-02 · Topic search rebuilds the whole sidebar per keystroke
- **Where:** `topics.html:867` `oninput="renderSidebar()"`; the rebuild is `topics.html:1592–1700`.
- **Symptom:** every character typed wipes and rebuilds up to 200 topic rows (200
  `createElement` + 200 `innerHTML` parses + 200 `renderEmojis()` walks) plus a sort and a filter
  over the 500-doc snapshot — multi-second freeze per keystroke on a jitless Kindle.
- **Fix:** point the input at a debounced wrapper (~250 ms; a debounce helper already exists two
  functions above), and cache the rendered emoji per topic id instead of re-running `renderEmojis`
  on every row.
- **Verify:** type 10 characters in the topic search on a slow profile; expect one rebuild.
- **Effort:** small · **Risk:** low · **Why deferred:** was queued behind the higher-impact P0s
  and not reached.

### BL-03 · Neighbourhood loses every paginated post when Admin/Mod Mode toggles
- **Where:** `neighbourhood.html:3010–3013` re-renders from `recentPosts`; `loadMorePosts`
  (`:2957–2978`) never appends to it.
- **Symptom:** toggling admin mode drops loaded pages for the rest of the session —
  `renderedPostKeys` still holds them, so `loadMorePosts` filters them out and they cannot return
  without a reload. `editPost` also no-ops for paginated posts because it uses
  `recentPosts.find(...)` (`:3821`).
- **Fix:** append every loaded page to `recentPosts` (or keep one `renderedPosts` list both paths
  write to), call `updateEndOfFeed(feed)` after the re-render, and make `editPost` fall back to the
  card's `data-post-id`/`data-original`.
- **Effort:** small · **Risk:** medium · **Verify:** open Neighbourhood, scroll to load 3 pages,
  toggle admin mode, confirm all posts remain and edit still works on the oldest one.

### BL-04 · Neighbourhood never detaches its listeners
- **Where:** `neighbourhood.html:2880` `postsListener` is assigned but never called; the scroll
  handler is added at `:2936` with no `removeEventListener`; `grep -c pagehide` → 0.
  `topics.html:3377` already implements the teardown to copy.
- **Symptom:** live snapshots keep arriving into a bfcache-restored page and the feed DOM +
  closures are retained.
- **Fix:** store the unsubscribe, add a `pagehide` handler that calls it, drains
  `commentListeners`, and removes the scroll handler.
- **Effort:** small · **Risk:** low.

### BL-05 · KindleChat translation arrivals rebuild whole bubbles
- **Where:** `kindlechat.html` translation `child_added` handler → `renderMessage` (look for
  `getMessageInsertionInfo` and the `existing` lookup); the comment near the scoped listener
  admits the whole rendered window re-fires on load.
- **Symptom:** ~50 full bubble rebuilds per page load; each rebuild does `innerHTML`, an emoji
  tree walk, an avatar canvas redraw and a `localStorage` parse via `rekindleFetchUserCard`, even
  when the translation equals the original (the worker writes an identity entry for the source
  language).
- **Fix:** look up `existing` first; when it exists skip the insertion-info scan and patch only
  the bubble text (`data-original`/`data-translated` + the bubble's `innerHTML`). Batch arrivals
  into one dirty-flag pass instead of one rebuild per snapshot.
- **Effort:** medium · **Risk:** medium · **Verify:** load general chat with translations on;
  count `renderMessage` calls (temporary counter) — expect ~N, not ~2N.

### BL-06 · KindleChat ASCII picker scroll spy forces layout per scroll event
- **Where:** `kindlechat.html:2666` scroll handler.
- **Symptom:** reads `scrollHeight`/`clientHeight` (forced layout), re-runs
  `querySelectorAll('.ascii-sidebar-item')`, toggles classes on all of them, and calls
  `scrollIntoView({behavior:'smooth'})` — a JS-driven animation e-ink's `transition: none` does not
  suppress — and re-enters itself.
- **Fix:** cache the metrics when the picker opens, query the sidebar items once, add a
  leading-edge timestamp guard, and use `behavior: 'auto'`.
- **Effort:** small · **Risk:** low.

### BL-07 · Journal: no merge, only a flush
- **Where:** fixed pass debounced the cache write, flushed on `pagehide`, and skips the cloud
  snapshot while a save is pending (`journal.html`, `flushPendingSave`).
- **Still open:** if the page is killed before the Firestore write lands, the next load still
  replaces `notes` with the older cloud copy. There is no `updated`-based merge.
- **Fix:**

  ```js
  var localById = {}; notes.forEach(function (n) { localById[n.id] = n; });
  notes = cloudNotes.map(function (c) {
      var l = localById[c.id];
      return (l && (l.updated || 0) > (c.updated || 0)) ? l : c;
  });
  // then re-push the newer local notes
  ```
- **Effort:** small · **Risk:** medium (deletions vs. newer-local semantics).
- **Verify:** type in a note, kill the tab before the 1 s debounce completes on a throttled
  connection, reopen, confirm the text survives.

### BL-08 · Report button still under the 48 px touch-target rule
- **Where:** `neighbourhood.html:336`, `topics.html:328` — now 32 px with `margin: -6px`.
- **Why not 48:** the button sits beside a timestamp (`neighbourhood`) and an Edit button
  (`topics.html:887`) with only an 8 px gap; a 48 px hit area would steal those taps.
- **Fix:** restructure the action row so Report has its own 48 px slot — e.g. move it into the
  comment/post action row with the same `min-height` as `.sys-btn`, or wrap the 20 px dot in a
  48 px transparent button and give the neighbouring controls their own row.
- **Effort:** small · **Risk:** low (visual only).
- **Verify:** tap-target audit at 1× zoom (48×48 minimum), and a mistap check around Edit.

### BL-09 · `getIdToken(true)` before every social write — PARTIAL
- **Shipped 2026-10-21:** cached `getIdToken()` + one forced refresh after a 401/403, in
  `kindlechat.html` (`doSendMessage`), `neighbourhood.html` (post + comment) and `topics.html`
  (comment). This is the hot path: one fewer Identity Toolkit round trip per post.
- **Still forced (9 sites):** `kindlechat.html` ×3 (DM send + translation retry paths),
  `neighbourhood.html` ×2 (background translation requests), `topics.html` ×1 (background
  translation), `flipbook.html` ×1, `pixel.html` ×1, `files.html` ×1.
- **Why the rest were left:** the remaining chat/feed calls are background work off the critical
  path, and the three single-use pages were not worth a bespoke retry path this pass.
- **Fix:** convert each the same way — cached token, retry once on 401/403 with a forced refresh.
  Keep a forced refresh where a just-granted `pro`/`ageVerified` claim must be visible immediately.
- **Verify:** grant Pro, return to chat, post immediately — must be allowed.

---

## P2 — performance on the target device

### BL-10 · Reader lays the whole book out as one DOM
- **Where:** `reader.html:1942` `MAX_CHARS = 2000000`, one `innerHTML` into `#gb-pane`;
  `changeFont` writes `fontSize` then reads `scrollHeight` twice (`:2732`, `:2863`).
- **Symptom:** multi-second freeze per font/header change on a long book.
- **Fix:** mount only the current chapter ±1 (one `innerHTML` per mount, so the i18n observer
  behaviour stays the same); at minimum drop `MAX_CHARS` to ~300k and add
  `contain: layout style` to `#gb-pane p`; cache the measured page height per render.
- **Effort:** large · **Risk:** high (pagination, scroll anchors, resume position) · **Verify:**
  open a 1 MB book, change font 5×, confirm page count and resume still work.

### BL-11 · Books list rebuilds both lists on every snapshot
- **Where:** `books.html:530–534` clears `#want-to-read-list` and `#read-list`; rows are rebuilt
  with fresh `<img>` covers (`:557–564`); query has no `.limit()`.
- **Fix:** `snapshot.docChanges()` — added builds one row, modified patches status/stars in place
  and leaves the `<img>` node alone, removed removes the node; add `.limit(100)` and `data-doc-id`.
- **Effort:** medium · **Risk:** medium · **Verify:** change one book's status; no cover re-fetch.

### BL-12 · Calendar day view does 24×N timezone conversions
- **Where:** `calendar.html:1476–1481` filters the day's events once per hour, calling
  `getZonedDate` per event per hour; agenda converts 3× per event and builds an `eventsMap` it
  never uses (`:1262`, `:1281`, `:1291`, `:1307`).
- **Fix:** convert each event once per render into a bucketed map (hour key / day key), reuse it
  for the day and agenda views, and delete or use the unused `eventsMap` argument.
- **Effort:** medium · **Risk:** low · **Verify:** event crossing midnight and a DST day.

### BL-13 · `time.js` re-parses storage and builds Intl formatters per call
- **Where:** `time.js:31–38`, `:61–73`, `:176–178` — two `localStorage` reads, two `JSON.parse`
  attempts and two `Intl` formats per formatted timestamp.
- **Fix:** cache the parsed location module-scope (invalidate on the settings/DST events) and one
  `Intl.DateTimeFormat` per zone+options key; format once.
- **Effort:** medium · **Risk:** low · **Verify:** feed with 50 messages; compare render time and
  displayed times across a DST boundary.

### BL-14 · Bluesky refetches the timeline and every image on return
- **Where:** `bluesky.html:846–854` `showFeed()` always calls `loadTimeline()`; embeds render up
  to 4 full-size `<img>` each with no dimensions (`:1219–1223`).
- **Fix:** keep the timeline in memory, refetch only on explicit refresh or after ~5 min; cap
  embeds at 2 + "+N images"; give images explicit CSS `width`/`height` so decode does not reflow.
- **Effort:** medium · **Risk:** low.

### BL-15 · Chat/DM/topic writes pay a serial RTDB timeout read first
- **Where:** `workers/rekindle-moderate/worker.js:1803` `checkTimeout` runs before
  `consumeRateLimitToken` (`:1844`); both hit the same RTDB, and the timeout node is empty for
  almost every user.
- **Fix:** cache the timeout per uid for 30–60 s (same pattern as `dmFlagCache` / `isDmEnabledForOrigin`)
  and run the two reads in one `Promise.all`.
- **Effort:** small · **Risk:** medium (a stale timeout could let one message through) ·
  **Verify:** set a timeout, confirm the next message is still rejected.

### BL-16 · `getSocialToken` makes 5–8 serial hops per social page load
- **Where:** `firebase-functions/index.js:1223–1298` — moderators, `isUserPro` (up to 2 reads),
  ageVerification, `admin.auth().getUser`, and a social-project `getUser`/`updateUser` kept only so
  users appear in the Firebase Console.
- **Symptom:** blocks `signInWithCustomToken`, so chat/feeds/art cannot load until all of it
  resolves.
- **Fix:** `Promise.all` the independent reads, drop the Console-visibility social lookup from the
  request path (do it once after first sign-in, fire-and-forget), cache moderators/pro per uid for
  ~5 min.
- **Effort:** medium · **Risk:** medium (auth claims) · **Verify:** cold visit to chat, measure
  time-to-first-message; confirm moderator/pro/ageVerified survive.

### BL-17 · `api/price.js` caps, but `stocks.html` still retries per symbol
- **Where:** `stocks.html:546` fires one request per symbol and `:612` retries 3× with a fixed
  500 ms delay; the proxy is now cached (fixed), but a cold cache still fans out.
- **Fix:** one `/api/price?symbols=A,B,C` batch (Yahoo supports it), or at least serialise with a
  cap and honour the cached response before retrying.
- **Effort:** small · **Risk:** low.

### BL-18 · Pixel wallpaper re-encodes a PNG per touched pixel
- **Where:** `settings.html:1386–1390` `updatePixel` → `renderGridUI()` + `updateWallpaper()`;
  `:1446–1450` `canvas.toDataURL('image/png')` + two `localStorage` writes.
- **Fix:** split into a cheap in-memory canvas paint (per pixel) and a commit path
  (`toDataURL` + `setItem`) called from `endDraw`/`savePixelData`; repaint only the changed cell.
- **Effort:** medium · **Risk:** low.

### BL-19 · Mail "load more" rebuilds every accumulated row
- **Where:** `mail.html:1194–1206` concatenates then calls `renderEmailList()`. Mark-read is now
  patched in place; paging is not.
- **Fix:** append only the new page's rows when `append` is set; keep the existing scroll offset.
- **Effort:** small · **Risk:** low.

### BL-20 · Sheet-music composer images grow `localStorage` without eviction
- **Where:** `sheetmusic.html` `fetchComposerImage` (~`:1193–1231`) writes `rekindle_img_*` keys
  forever. Search is now debounced; the cache is still unbounded (64 MB global limit → OS wipes
  the whole cache).
- **Fix:** cap at ~100 keys with an LRU index (same shape as `reddit.html`'s
  `reddit_feed_xml_lru`), and skip the fetch for cards already rendered.
- **Effort:** small · **Risk:** low.

---

## P3 — maintainability (needs a visual QA pass)

### BL-21 · Shared helpers duplicated across pages, already diverged
- **Measured:** `escapeHtml`/`escapeHTML` 64 definitions (36 + 28, 14 distinct bodies);
  `showModal` 32 (20 bodies); `drawAvatar` 12 (2 variants); `sanitizeBackgroundImage` 28 —
  27 identical, `chords.html:742` also allows `http`/`/` URLs.
- **Fix:** one `escapeHtml` in `js/safe-html.js`, `showModal`/`drawAvatar` in `js/ui-kit.js`, one
  `sanitizeBackgroundImage` (decide whether `http` is allowed), then delete the page copies and
  bump `?v=` for the shared files.
- **Effort:** medium · **Risk:** medium (32 pages' modal behaviour differs subtly) ·
  **Verify:** per-page modal open/close, avatar rendering, chords background.

### BL-22 · System 7 chrome re-declared in 135 pages
- **Measured:** 1,464,426 B of inline CSS across 137 pages (avg 10,689 B); `:root` 137, `body` 137,
  `.window` 135, `.title-bar` 136, `.title-stripes`/`.title-text`/`.close-box` 135 each;
  ~367 KB of byte-similar chrome.
- **Fix:** `css/system7.css` (~3 KB) for the canonical chrome + `sw.js` precache, page-specific
  overrides stay inline.
- **Effort:** medium · **Risk:** medium–high (every page's layout) · **Verify:** screenshot
  harness in [visual-audit.md](visual-audit.md) across a sample of 20 pages.

### BL-23 · Locale files carry dead keys
- **Measured 2026-10-21:** `en.json` 3,533 keys. `node scripts/check-unused-locales.js`
  (`npm run locales:report`) reports **355 candidates** after excluding literal references and
  dynamic prefixes (`app.`, `journal.cause.`, `gamerules.`, `oregontrail.month.`, …); the top
  namespaces are `neighbourhood` 38, `ao3` 31, `oregontrail` 26, `kindlechat` 20.
  `gamerules.*` (29) are dead *and* the rules stay English-only because `js/gamerules.js` hardcodes
  the same HTML.
- **Shipped:** the report script only. **Not pruned:** several namespaces are still composed at
  runtime and a wrong prune shows raw keys to non-English users.
- **Fix when pruning:** run the report, review each namespace for dynamic construction, prune all
  ten locale files together, and make `js/gamerules.js` read `window.t('gamerules.' + id, fallback)`
  so those keys stop being dead and become translatable.
- **Effort:** medium · **Risk:** medium · **Verify:** load every page in `?lang=de|es|pt` and diff
  visible text against `en`.

### BL-24 · Four pages still use native `<select>`
- **Where:** `akinator.html` (1), `comics.html` (1), `moderation.html` (5), `readwise.html` (2).
  The other 23 pages use `js/custom-select.js`.
- **Fix:** include the widget and re-apply the modal layout rules from AGENTS ("Modal gotcha").
- **Effort:** small per page · **Risk:** medium (modal CSS) · **Verify:** each page's select opens,
  selects, and respects `disabled`.

### BL-25 · `index_old.html` is a 66 KB fork of `index.html`
- **Where:** `build-automation.js:1703` swaps it in as `index.html` for the Lite and Legacy builds.
- **What has drifted:** it predates several dashboard features (the live-games section and its
  validator, the Help app entry, later auth/timezone wiring). It is **not** a live-lobby bug —
  see BL-01: the fork simply has no live-games UI.
- **Fix:** extract the shared dashboard (app grid, favourites, badges, auth) into
  `js/dashboard.js` and keep only layout deltas in the two files. Until then, every dashboard
  feature must be applied twice or it silently diverges on Lite/Kobo.
- **2026-10-21:** the modern dashboard gained an app search field and a Recent row; the Lite/Legacy
  fork has neither, so the feature gap is now larger.
- **Effort:** large · **Risk:** high (needs the Lite build to be exercised).

### BL-26 · Dead files and dead code still shipped
- **Shipped 2026-10-21:** `sw-offline.js` and `sw-killswitch.js` were referenced by nothing and are
  now deleted (they also had their own asset lists that would fight `sw.js`).
- **Still open:** `manga.html` (51 KB) and `texasholdem.html` (38 KB) are unreachable (not in
  `icons.js` APPS, no inbound links) yet still built, with locale keys, a third-party CDN
  dependency and a `gamerules`/score entry.
- **Fix:** register the two apps (manga needs a MangaDex API review) **or** delete them plus their
  locale keys / gamerules / score entries. This is a product decision, not a code one.
- **Effort:** small · **Risk:** low (registering) / medium (deleting — bookmarkable URLs).

### BL-27 · Backend payment/maintenance scripts — PARTIAL
- **Shipped 2026-10-21:** Stripe OAuth token + Google JWK caches (no more token mint per call),
  supporters add/remove now PATCH a single field with `updateMask` (concurrent webhooks can no
  longer drop each other), and mail callables reuse a 60 s Pro-status cache. Private-key material
  is no longer logged.
- **Still open:** the mail callables open a cold IMAP session per call, and `mail.html` awaits
  `loadFolders()` before `loadEmails()` because the latter needs `currentFolder`.
- **Original evidence:** **`workers/rekindle-stripe/worker.js:371`, `:644`, `:1103`, `:1141`** — mints a fresh OAuth token
  per call and refetches Google JWKs per checkout; the moderate worker already caches both
  (`worker.js:25`, `:545`). Copy that pattern.
- **`workers/rekindle-stripe/worker.js:958–1038`** — `addToSupportersConfig` /
  `removeFromSupportersConfig` read-modify-write the whole supporters map with no field mask; two
  concurrent webhooks drop a subscriber. Use `updateMask.fieldPaths` or one doc per email.
- **`firebase-functions/index.js:205–213`, `:555`** — every mail callable re-checks Pro with up to
  2 Firestore reads and opens a cold IMAP session; `mail.html:1064` awaits folders *then* emails.
  Cache the Pro result ~60 s, invalidated by the Stripe webhook, and parallelise the two callables.
- **Effort:** small each · **Risk:** medium–high (auth/payments; cannot be exercised locally).

### BL-28 · Remaining smaller items
- **`topics.html` poll votes:** `loadPollVotesOnce` downloads the whole `pollVotes` collection per
  topic open and again after each vote, counting client-side. Store an aggregate count on the topic
  doc (worker-incremented, like `commentCount`) or at least `.limit()` it.
- **`index.html` matchmaking:** the Multiplayer tab attaches a second full-node listener and calls
  `validateLiveMatch` directly, bypassing the 30 s cache. The badge listener is now auth-gated and
  detached on `pagehide`, but the two still duplicate work — one server-filtered query
  (`.orderByChild('status').equalTo('waiting')` + `.indexOn`) shared by both would fix it.
- **`moderation.html` shell:** loads neither `theme.js` nor `js/i18n.js` and has zero `data-i18n`
  attributes, so adding i18n alone is a no-op. Decide whether the admin page should adopt the
  shared shell (zoom/rotation/font) and comment the choice either way.

---

## Partially done (and where it stopped)

**After the 2026-10-21 pass this table only contains work that is still split.** Everything else
that was listed here (report-button size, journal merge, mail append, chat translation patching)
is now complete.

| Item | Done | Not done |
|---|---|---|
| Watchlist | seasons fetched in batches of 3 | lazy episode loading / store only the season count |
| Bible | lazy dataset load, `onLibraryChange` awaits it | request sequencing (`reqId`/abort) and a chapter cache |
| Dropbox | `has_more`/`cursor` pagination | per-path navigation cache (Back re-lists) |
| Calendar | listener unsubscribes; hour bucketing | date-bounded event query (still `.get()` of the whole collection) |
| Reddit | feed cache capped at 5 subs | wrapper-level cache (relies on the proxy) |
| Books | incremental list rendering | `.limit()` on the reading-list query |
| Stocks | batch of 4 + one retry | a multi-symbol proxy endpoint (Yahoo chart is per-symbol) |
| KindleChat token | cached + retry on the general send | 3 forced refreshes remain (BL-09) |
| Reader | — | `MAX_CHARS` still 2,000,000 and one DOM for the whole book (BL-10) |

## Verification notes for whoever picks these up

- `npm test` covers i18n keys, Chromium-75 compatibility, the proxy guard, claim merging, chat
  spam, DMs and Oregon Trail — but **not** layout, Firebase behaviour, or anything on a device.
- Inline scripts can be syntax-checked without a browser:
  extract each `<script>` without `src` and `new Function(code)` (this is how the fix pass checked
  162 scripts across 138 pages).
- After touching a shared script, bump `?v=` in **every** including page (and `sw.js`
  `ASSETS_TO_CACHE` if listed), then `npm run build` — the deploy ships `_deploy/main`.
