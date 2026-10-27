# Performance Playbook (e-ink / slow devices)

The 2026-07 audit behind the perf rules. Read before optimising any page for the Kindle.

## ⚡ Performance Patterns for Slow Devices (2026-07 audit + fixes)

A codebase-wide performance audit for the Kindle target produced these fixes and reusable patterns. Follow them in any new feed/game/editor.

### CSS containment on repeated feed items
`.msg` / `.gallery-item` (kindlechat.html), `.post-card` / `.comment-item` (neighbourhood.html), `.topic-item` / `.msg` (topics.html) carry `contain: content` (when the rule already has `overflow: hidden`) or `contain: layout style` (otherwise, so overflowing decorations aren't clipped). This stops per-append reflows from walking the whole feed. Add it to any new repeated feed/list item.

### Dirty-flag rendering (tetris.html, crossy.html, pet.html)
Unconditional `draw()` every rAF costs e-ink compositing + (with any AA pixel) full grayscale refreshes even when idle. Pattern: a `drawNeeded`/`renderSig` gate — set the flag wherever visible state changes (moves, drops, spawns, camera/black movement on visible rows), draw only when set. tetris.html also had per-cell `strokeRect` with `lineWidth 0.1` (AA grays = the Surfer full-refresh bug) — removed; filled cells are `fillRect` only. pet.html's tick additionally caches the `.title-text` element and only writes `innerText` when the age string changes, and only runs `updateIconUI()` when its inputs (menuIndex/attention blink phase/stage) change.

### Coordinate-conversion rect caching (livepictionary/pixel/flipbook/pool)
`getBoundingClientRect()` per pointermove (or per coalesced point) forces synchronous layout per event. Pattern: cache the rect on stroke/drag start (`pointerdown`), use it for all moves in that stroke, null it on stroke end and on canvas resize. livepictionary.html additionally caches the `--rekindle-scale` `getComputedStyle` read the same way (see `computeCanvasTransform()`).

### Incremental comments via `docChanges()` (neighbourhood.html)
The comments listener was `innerHTML = ''` + re-render ALL (≤100) comments per snapshot. Now uses `snapshot.docChanges()`: added → render only the new node (position via `snapshot.docs[change.newIndex - 1]` — query is newest-first, DOM is oldest-first), removed → remove that node, modified → re-render in place. Elements carry `data-comment-id` for lookup. topics.html comments were already incremental; their eager initial load now appends through a `DocumentFragment` (`appendMessage(msg, prepend, container)`).

### Language detection stays off the load path (2026-10-27)
`js/lang-detect.js` is a ~366 KB raw / ~119 KB gzip ELD model. Do not add it as a
`<script>` on social pages, and do not preload it on composer focus: that 119 KB
download competed with the message POST on a slow Kindle and made sending feel
slow. `js/post-language.js` is loaded only when the auto queue meets legacy
content with no stored `lang`, or 4 s after a successful post (off the send
path). Until it is ready, `detectPostLang()` sends no `lang`; the message is
detected on view instead. This is why the KindleChat/Neighbourhood/Topics
load-budget numbers did not move when post language detection landed.

### KindleChat message pipeline (kindlechat.html)
- Initial 50-message batch renders with `history.style.display = 'none'`, then shows + scrolls once (one reflow instead of 50). Safe because `renderMessage`/`getMessageInsertionInfo` do no layout reads — keep it that way.
- `generalMsgData` mirrors `renderedKindlechatIds` with the message bodies, so translation `child_added`/`child_changed` handlers re-render from cache instead of an extra `generalChatRef.child(msgId).once('value')` per message (was ~50 fetches + 50 full rebuilds at load). Both handlers also bail if the `.msg[data-msg-id]` element is gone — re-rendering a window-slid message would wrongly re-append it.
- Flipnote autoplay loops (`playFlipnote`, `playGalleryFlipbook`) guard `!imgEl.isConnected` — detached message nodes kept their `dataset.playing` and animated forever before. `hideModal()` also explicitly stops the gallery flipbook timer.
- The dead `getCachedMessages`/`getLastCachedTimestamp`/`cacheMessages` localStorage block was removed; don't re-add without wiring it up.

### Misc
- `liveuno.html` hand/opponent render builds HTML in an array + single `innerHTML` assignment (was `innerHTML +=` per card = O(n²) reparse per game event). Same pattern fixed in `journal.html` month render (~49 `+=` per month), which also indexes notes by id (`notesById`) instead of `notes.find()` per day.
- `words.html` board cells are cached in the `boardCells[y][x]` 2D array built by `initBoard()` — never re-query `.sq[data-x][data-y]` per tile.
- `wordle.html`/`nerdle.html` no longer `console.log` the answer (also a cheat vector).

### Two traps when applying these perf patterns (hit 2026-07, fixed)
1. **Don't add a debounce helper without wiring it.** `notes.html` gained `scheduleCacheWrite()`/`flushCacheWrite()`/`pagehide` flush, but `saveNoteData()` still called `updateCache()` directly — the optimisation was inert until `saveNoteData` was changed to call `scheduleCacheWrite()` (it runs on every keystroke via `saveCurrentNote`'s `oninput`). Note the two storage keys: logged-in cache is `rekindle_notes_cache` (`NOTES_CACHE_KEY`, via `updateCache()`), the anonymous list is `rekindle_notes` — `flushCacheWrite()` must branch on `currentUser` to pick the right one. If you add a debounced write anywhere, grep for its call site in the same commit.
2. **When you delete a listener, delete every reference to its unsubscribe var.** `topics.html`'s poll listener was converted to a one-time `loadPollVotesOnce()`, the `var pollVotesUnsubscribe = null;` declaration was removed, but `detachAllListeners()` still did `if (pollVotesUnsubscribe) { pollVotesUnsubscribe(); }`. Reading an undeclared identifier throws `ReferenceError`, which the function's `catch (e) { /* ignore */ }` silently swallowed — so `topicsListenerRef`, `rulesListenerRef`, `sidebarRenderTimer` and all the state resets after it were **skipped on every pagehide**. Any `try/catch` that wraps a whole teardown sequence will hide this class of bug: after removing a `var`, grep the file (and other scripts) for the name and run the inline-script syntax check before shipping.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).

### 2026-10-20 follow-up fixes (audit `docs/audit-2026-10-20.md`)

Applied in one batch; each is independently revertable.

- **`js/i18n.js` no longer fetches `locales/en.json`.** 173 KB / 3,520 keys were downloaded and `JSON.parse`d on every navigation to resolve three attribute-only strings (now inlined as markup fallbacks). Pages with `data-i18n-file` still fetch their file. The `MutationObserver` also skips inserted leaves with no i18n attributes (`needsTranslation()`), and does nothing but `data-i18n-only` when the translation table is empty (English).
- **`theme.js` `init()` runs once.** The old code called the whole set on `DOMContentLoaded` *and* immediately after, and `applyTheme`/`applyFont` a third time. `FONT_KEY` moved to the top of the file so the single early `init()` still sees it.
- **`journal.html`** debris: `updateCache()` is debounced 500 ms instead of running synchronously on every keystroke, flushed on `pagehide`/`visibilitychange`, and a pending save no longer gets clobbered by the next cloud snapshot.
- **`timer.html`**: interval callbacks save at most every 10 s (`saveStateThrottled`); the stopwatch used to write 5 keys every 100 ms. Transitions still call `saveState()` and `pagehide` flushes.
- **`rssreader.html`**: opening an article patches one card (`updateArticleReadState`) instead of rebuilding the whole list, and the per-article blob URL is revoked on close/replace.
- **`mail.html`**: marking a message read toggles one row (rows carry `data-uid`) instead of re-rendering the list.
- **`bible.html`**: scripture datasets load on demand (`ensureLocalScriptureData`) instead of ~272 KB of Dhammapada/Tao JSON before the first chapter.
- **`watchlist.html`**: TMDB seasons fetch in parallel batches of 3 instead of one serial request per season.
- **`dropbox.html`**: follows `has_more`/`cursor` with `filesListFolderContinue` (500-entry cap) and redraws once.
- **`reddit.html`**: cached feed payloads are capped at 5 subs with an LRU index instead of one `reddit_feed_xml_*` key per subreddit forever.
- **`functions/api/price.js`**: edge cache + "last good" stale fallback + `Retry-After`-friendly retry on the alternate host (matches the other proxies).
- **`settings.html`**: the pixel wallpaper editor still re-encodes per touched pixel (not changed) but location is now plain JSON - see AGENTS.md.

### 2026-10-21 backlog pass (audit `docs/audit-2026-10-20.md`, backlog `docs/agent/backlog.md`)

- **`time.js`**: the location blob is parsed once and cached (keyed on the raw string), and
  `rekindle_timezone_offset` is cached too. Feeds that format 3–4 timestamps per row were paying
  two `localStorage` reads + two `JSON.parse` per timestamp. `window.rekindleInvalidateTimeCaches()`
  is called by `settings.html` and by `time.js`'s own save path.
- **`calendar.html`**: day view buckets events by hour once (was `getZonedDate` per event per
  hour, 24×N); agenda reuses the zoned date computed for its filter instead of converting again.
- **`topics.html`**: the topic search input is debounced (`debouncedRenderSidebar`, 250 ms) and the
  standing listener patches `allTopicsCache` from `docChanges()` instead of re-mapping 200 docs per
  snapshot.
- **`books.html`**: the saved-books listener is incremental — added/modified/removed patch one
  `[data-doc-id]` row; a status change no longer clears both lists and re-decodes every cover.
- **`mail.html`**: "load more" appends only the new page's rows (`appendEmailRows`); the load-more
  button is re-created in place.
- **`bluesky.html`**: the rendered timeline is reused for 5 minutes (Back from a profile no longer
  refetches 30 posts + every image); embeds are capped at 2 images with a "+N more" line.
- **`stocks.html`**: requests run in batches of 4 with one retry instead of all-at-once ×3.
- **`settings.html`**: pixel wallpaper painting is split into a cheap canvas preview during the
  drag and one `toDataURL` + storage commit on `endDraw`.
- **`theme.js`**: the presence init tries immediately, then polls at 500 ms for at most 10 s
  (was 1 s × 30 = 30 s).
- **`index.html`**: the matchmaking badge listener now attaches only after auth resolves (RTDB
  rules require it) and detaches on `pagehide`.
- **`sheetmusic.html`**: composer-image cache capped at 100 entries with an LRU index.
- **`stocks`/`price`** unchanged beyond batching; `functions/api/price.js` cache landed earlier.

### Neighbourhood comment counts are denormalised (2026-10-21)

**Symptom:** the feed showed no comment count on a collapsed post. The only place a count was
produced was inside `loadComments()`'s `onSnapshot` (`snapshot.size`), so a user had to expand a
post — reading every comment document in it — before "Comments (3)" appeared, and any re-render
(admin mode toggle, translation arriving, a `modified` post snapshot) threw the number away again.

**Now:** `neighbourhood_posts/{id}.commentCount` is a denormalised counter and the single source of
truth for the toggle label.

- `renderPostItem()` prints it from `post.commentCount` — no extra reads, and no comments listener
  is attached for a collapsed post.
- `workers/rekindle-moderate/worker.js`, `neighbourhood_comment` handler: increments it in the same
  request that creates the comment (`firestoreCommitTransform`), and `autoDeleteContent()`
  decrements it for report-driven deletes (clamped at 0 via `adjustParentCommentCount()`).
  `moderation.html` re-increments when a moderator undoes a delete.
- `deleteComment()` in `neighbourhood.html` decrements with a `runTransaction` clamped at 0 (the
  delete itself is client-side, so the worker never sees it).
- `loadComments()` reconciles: while a list is open, `snapshot.size` wins (skipped at the 100-doc
  query cap) and a mismatch is written back once, so posts that predate the field heal the first
  time anyone opens them.
- `firestore-social.rules` already allowed a `commentCount`-only update from any age-verified user,
  which is what makes the client-side decrement legal.
- A `commentCount`-only write reaches every other viewer as a `modified` post snapshot.
  `postRenderSignature()` (uid + text + translation) lets the feed refresh just the number instead
  of rebuilding the card — a rebuild drops the open comment list and re-reads it.
- Topic comments got the same treatment in `autoDeleteContent()` (decrement
  `topics/{topicId}.commentCount`) and in the moderation undo path.
- Backfill for posts that predate the field: `node admin/backfill_neighbourhood_comment_counts.js`
  (dry run by default; `--apply` writes).

**Rule for future code:** any new comment create/delete path must adjust the parent's
`commentCount` in the same code path, or the feed silently lies. `deleteComment()` and the worker
were the only two paths when this landed.


## Suggestions board pagination — 2026-10-24

**Symptom:** `suggestions.html` ran `rtdb.ref('suggestions').once('value')` on
every load *and every tab switch*. By 2026-10-24 the board held 751 records
(224 open + comments) and the full snapshot was **1.10 MB**; comments alone were
**577 KB (55%)**, even though comments are only read when a detail view opens.
On a Kindle that is a slow first paint and a full re-download for every tab.

**Fix:** load one chronological window with
`orderByChild('createdAt').limitToLast(120)` (about **110 KB**, a 90% cut),
keep it in `allSuggestions`, and make tab switches call
`loadSuggestions(false)`, which just re-renders the cached window. A
**Load older** footer appends the next 120 with
`endAt(oldestLoadedCreatedAt - 1)`. A short page (`numChildren() < 120`) means
the end of the list. Search still filters the loaded window; the footer says so
(`suggestions.msg.search_scope`), and the new-idea duplicate finder searches the
same window.

**My Suggestions:** the Mine tab does **not** use the newest-120 window. It runs a
one-shot `orderByChild('authorUid').equalTo(uid)` query (indexed in
`rtdb-rules.json`) and merges those records into the cache, so a user's older
ideas still appear. The footer suppresses "Load older" on that tab.

**Trade-off:** "Popular" now means popular among the loaded window, not all
time. That is intentional — the newest ideas are what the board is for, and
`Load older` reaches the rest. If all-time popularity becomes a requirement,
denormalise a numeric `voteCount` per suggestion and load a second
`orderByChild('voteCount').limitToLast(50)` page rather than restoring the 1 MB
fetch.

**Rules for future additions:** never add a listener to the bare
`suggestions` ref; always bound it. Comments stay inline in each record for now
(no migration); if the payload needs another cut, move them to
`suggestion_comments/{id}` and load on detail open, which would halve the
remaining page again.

### Suggestions shipped-status sweep (2026-10-24)

`admin/mark_shipped_suggestions.js` is a dry-run-by-default admin script that
marks a **title-checked** allowlist of suggestions `done` (`--apply` writes via
the Admin SDK). On 2026-10-24 it closed 7 records: the three Cookie Clicker
posts, Add FAQ, Update log, app search and more reactions. It deliberately does
not touch `FAQ in suggestions` — that record asks for answers *inside* the
board, and the current implementation links to the FAQ/refund answer from the
triage strip rather than rendering it inline. Add a row only after verifying
the feature in the built output; the script refuses a title mismatch.

## Load path: getting to the page (2026-10-26)

The 2026-07 pattern list above is about *rendering*; this section is about *transport and boot*,
measured on the repo on 2026-10-26. Read it before adding a script tag, a header rule or a SW route.

### Baseline that drove the pass

| Fact | Measurement |
| :--- | :--- |
| KindleChat boot | 28 requests, ~345 KB compressed: HTML 66 + local ~60 + **Firebase 176** |
| Firebase SDK (compressed) | app 5.7 · auth 35.5 · firestore **84.2** · database 47.9 · functions 3.2 KB |
| Parser-blocking scripts | 21 on KindleChat, `<body>` started at line 1681 |
| Asset cache | `max-age=14400, must-revalidate` — every asset revalidated after 4 h |
| Locales | 45–52 KB compressed **per page** for non-English users, cached 1 h |
| `defer` usage | 129 of 141 pages used none |
| `presence/` | written on all 141 `theme.js` pages, read by **only `index.html`** |
| `counter.dev` | 95 pages, **90 blocking**, 30-minute cache |

### Rules that now hold (and the guard that keeps them)

1. **Every local script/stylesheet is versioned (`?v=N`).** `_headers` serves `/*.js` and `/*.css`
   `max-age=31536000, immutable`, and the service worker serves those URLs cache-first. The only
   exceptions are `mario_assets/*` (detached back to 4 h in `_headers`) — `scripts/test-load-budget.js`
   fails the build on any new unversioned reference, and asserts the `! Cache-Control` detach lines
   for `/sw.js`, `/mario_assets/*` and `/downloads/kpm/*` still exist.
2. **Bump `?v=` when the bytes change.** A missed bump is now a *year-long* stale file, not a 4-hour one.
3. **Versioned assets and `locales/*.json` are cache-first in `sw.js`.** Freshness across deploys comes
   from the build-stamped `CACHE_NAME` + `activate` cleanup — never add a manual cache-bust there.
4. **HTML is stale-while-revalidate with a 5-minute window** (`serveHtml`/`HTML_FRESH_MS`). Inside the
   window the cached copy is served instantly and revalidated in the background; outside it, network
   first. A failed navigation falls back to the *same* URL, not `index.html`.
5. **Nothing third-party may block the parser** unless it is in `BLOCKING_ALLOWLIST` in
   `scripts/test-load-budget.js` (Firebase SDKs + a few pinned libraries). Analytics and the Google
   API loader are `defer`.
6. **Preconnect, don't vendor.** gstatic already sends a one-year cache, so the only cost is the first
   handshake: pages that load Firebase carry `<link rel="preconnect" href="https://www.gstatic.com" crossorigin>`
   plus `firestore.googleapis.com` and the exact `*-default-rtdb.firebaseio.com` host(s) their config
   uses (generated from `databaseURL`/`projectId`, so it is precise).
7. **Scripts that are not needed for the shell go after the markup, not in `<head>`.** KindleChat,
   Neighbourhood, Topics, Suggestions, Flipbook, AirType and Pixel keep only `theme.js` + `js/i18n.js`
   in the head and load everything else immediately before their inline app script — order preserved,
   first paint no longer waits for 176 KB of SDK. `scripts/test-load-budget.js` prints
   "blocking in `<head>`" separately from "total" so the difference stays visible.
8. **`bad_words.js` (~18 KB) is lazy.** Dashboard/login load it on first use via `ensureBadWords()`
   (`await ensureBadWords()` before `isBadWord`); only the social pages that censor displayed text load
   it eagerly.
9. **Presence is opt-in.** `theme.js` writes `presence/{uid}` only when the page sets
   `window.rekindlePresence = true` or `<body data-presence="1">` — today only `index.html`. Don't
   re-enable it site-wide: it opened a realtime connection and a write on every navigation, and the
   poller used to fire 20× on pages that never loaded the RTDB SDK.

### Verifying a change

```bash
node scripts/test-load-budget.js      # versioning + blocking-third-party guard + per-page budget
node scripts/test-kindle.js           # theme.js version must match sw.js + kindle.html
scripts/shot-webkit.sh "http://127.0.0.1:8899/kindlechat.html?lang=en&theme=light" 758 1024 /tmp/chat.png
```
The WebKit harness takes an optional JS argument; throw inside it to get a `js error:` line on stdout,
which is the cheapest way to assert "`firebase.apps.length > 0`" and friends after a boot reorder.
