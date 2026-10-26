# KindleChat Deep Dives

Area notes for `kindlechat.html` and its supporting assets (`emojis.js`, `sw.js`, `_headers`, the moderation worker's emoji list). Cross-cutting rules are in [AGENTS.md](../../AGENTS.md); read that first.

**Worker endpoints (2026-10-25):** the moderation and translation Workers live in the
separate **ReKindle Social** Cloudflare account. Read the URLs from
[`js/social-endpoints.js`](../../js/social-endpoints.js) (literal fallbacks are in
`kindlechat.html`); do not reintroduce the old `*.timjarnott.workers.dev` URLs. Deploy
details and the account ID are in [usage-limits.md](usage-limits.md#2026-10-25-split--socials-moved-to-a-separate-cloudflare-account).

## Worker Outage Handling — never show "Load failed" (2026-10-25)

When the Cloudflare account exhausts its 100k/day Workers Free allowance, **every**
worker URL returns the `error code: 1027` page: HTTP 429, plain text, and **no CORS
headers**. The browser therefore rejects the `fetch` itself (`TypeError: Load failed`
in Safari, `Failed to fetch` in Chrome), so `resp.json()` never runs and there is no
status code or worker error to show. The 2026-10-25 incident was exactly this (see
[usage-limits.md](usage-limits.md#2026-10-25-1027-outage--kindlechat-unable-to-post-load-failed-fixed-same-day)).

`kindlechat.html` now has a small outage layer (search for `SERVICE_OUTAGE_MESSAGE`):

- `readWorkerJson(resp)` parses `resp.text()` itself. JSON is returned (with
  `__status`); a non-JSON `429`/`5xx` arms a **two-minute cooldown** and returns
  `null`. Do not go back to `resp.json()` — it throws an opaque parse error on the
  1027 page (when CORS lets the body through at all).
- `isTransportFailure(e)` recognises `Load failed` / `Failed to fetch` / `TypeError`.
- While the cooldown is active, `doSendMessage`, `sendDmMessage` and
  `fireTranslationRequest` show **one** "Chat is temporarily unavailable. Please try
  again in a few minutes." message and do not fire more requests. This is what stops
  the alert-per-click behaviour reported in Suggestions ("Remove the alerts").
- A failed post keeps the typed text in the composer (`inputEl.innerHTML` is only
  cleared on success), so the user can retry after the cooldown.
- The translation retry ladder checks the same cooldown: it schedules its next
  (bounded) attempt instead of firing four requests into a dead worker.
- `js/worker-client.js` provides the same logic to `neighbourhood.html` and
  `topics.html` (`window.rekindleWorkerClient.readJson` / `errorMessage`). Keep the
  message and cooldown in sync if you change either copy.

Rule for future worker calls: parse with the outage helper, never expose a raw
transport error, and keep writes idempotent — the user *will* retry once the cooldown
expires.

## KindleChat Translations Listener Must Be Key-Scoped

**Never attach a bare-ref listener to `kindlechat/translations_by_lang/{lang}`.** Each language node holds every translation ever written (~25,000 entries / ~1.2 MB per language as of 2026-07, growing unboundedly). A bare `.on('child_added')` forces every client to download ~1 MB and process ~25k callbacks on every page load, which effectively kills the Kindle browser — this was the root cause of "translations not showing" even though the `rekindle-translate` worker was writing them correctly.

**Pattern (implemented in `kindlechat.html` `loadGeneralFromRTDB()`):**
- Push IDs sort chronologically, so scope the listener to the rendered window: `ref.orderByKey().startAt(oldestGeneralKey).limitToLast(200)` where `oldestGeneralKey` is the first (oldest) key from the initial `limitToLast(50)` messages load. This covers the live window plus all future messages (new keys are always greater). **The `limitToLast(200)` is required:** `startAt` alone has no upper bound, so in a dormant room (oldest rendered message months old) it still syncs every translation created since then — potentially the entire 25k-entry node. 200 keys always include the 50 rendered messages.
- Paginated older messages (`loadMoreGeneralFromRTDB()`) are older than `startAt`, so fetch their translations individually on demand: `translations_by_lang/{lang}/{msgId}.once('value')`, cache into `langTranslations`, then re-render that bubble.
- New translation features that add listener paths must follow the same scoping rule.

To audit translation pipeline health, query RTDB directly with `service-account-social.json` (in repo root) via firebase-admin: compare `kindlechat/messages` timestamps against `kindlechat/translations_by_lang` keys.

## KindleChat Translation Worker Pipeline (rebuilt 2026-07-22)

**Regression lesson:** the June 2026 "confidence score" commit added an `isProbablyEnglish()` early-bail in `translateToAllLanguages()` that wrote **zero translations in any language** for English messages. Non-English coverage collapsed from ~78% of messages to <1% overnight ("translation never works" for non-English readers). **Never skip translating entirely based on detected source language** — only suppress the same-language target.

Current design in `workers/rekindle-translate/worker.js`:

- **Canonical source detection:** `detectLanguageInfo()` makes ONE Google call (`sl=auto&tl=en`) that returns the detected language, a confidence score (`data[6]`), AND the English translation. `resolveSourceLang()` picks the source: `isProbablyEnglish()` heuristics → `'en'`, otherwise the detected code. All target translations then use explicit `sl=sourceLang` (never 10 independent auto-detects).
- **Identity entries:** the entry for the source language itself is always the original text (e.g. `es: <original>` for a Spanish message). Clients already suppress translations identical to the original, so source-language readers see the original and every other language gets a real translation.
- **Detect/en merge:** for non-English sources, the detect call's English output (`translatedToEn`) is reused as the `en` entry — non-English messages cost 9 Google calls total, not 10-11.
- **Sequential targets:** the remaining 8-9 target calls run sequentially with a 75ms stagger. Do **NOT** `Promise.all` them — Google's gtx endpoint 429s parallel bursts from shared Cloudflare egress IPs (verified 2026-07: a parallel fan-out got all 9 target calls rate-limited while the identity entry still wrote, producing en-only coverage). `translateWithGoogle()` makes 3 attempts with jittered exponential backoff (600ms, 1800ms) and returns `retryable: true` only for 429/5xx/network failures (not for identical/suppressed results — those must never be retried).
- **Client-scheduled retries (no cron — deliberate, to avoid idle Firebase usage):** every worker response includes `missing: [...]` (languages that failed retryably) and `sourceLang`. `fireTranslationRequest()` in `kindlechat.html` re-fires with `missingLangs` + `sourceLang` in the body after 20s/60s/180s (max 4 attempts), and the worker then translates ONLY those languages without re-detecting. Retries live and die with the sender's browser session — if the sender leaves, remaining languages stay untranslated. Google's per-IP 429s come in multi-minute bursts, so spreading retries over minutes is what fills the gaps; in-request backoff alone cannot.
- **Confidence thresholds in `isProbablyEnglish()`:** `detectedLang === 'en'` → English; `confidence >= 0.85` → trust the non-English detection; identical/contained after stripping punctuation → English; `confidence < 0.85` with >85% Latin/ASCII chars → English (the `< 0.85` bound deliberately covers the 0.75-0.85 mid-confidence window where English slang was being force-translated from a mis-detected language into garbage `en` output).
- **Every message should now produce all 10 language entries** (immediately in clear windows, within ~4 minutes via client retries during 429 storms). If an audit shows English messages stuck at en-only with no other entries appearing over time, the client retry loop is broken — that is the signature to look for.
- **Translation cache (2026-10-25):** `translateToAllLanguages()` checks the Cloudflare Cache API before calling Google. `full/all/{sha256}` stores a complete map for the auto-detect path; `lang/{target}-{source}/{sha256}` stores individual values for `missingLangs` retries (source included so a client-supplied `knownSourceLang` cannot poison the shared entry); `detect/auto/{sha256}` stores detection only when Google answered (`ok !== false`). 7-day TTL. A full cache hit skips the detect call, all Google calls and the 75 ms stagger, but the handler still writes the per-message `translations_by_lang/{lang}/{msgId}` entries — one Worker invocation per message is unchanged. Bump the `/v1/` key prefix if `targetLangs` changes, otherwise old maps miss the new language.

## KindleChat Art Gallery & `kindlechat/art_index`

The KindleChat gallery (`kindlechat.html`) shows only pixel art and flipbooks. To avoid downloading every chat message, the gallery reads from a dedicated RTDB index at `kindlechat/art_index`.

### Architecture

- `kindlechat/art_index/{messageId}` stores a lightweight record for every art post:
  - `type`: `"pixel_art"` or `"flipbook"`
  - `uid`: author UID
  - `timestamp`: server timestamp
  - `thumbnail`: data URL (pixel art image or first flipbook frame)
  - `text`: caption text
- The gallery queries `art_index` ordered by `timestamp` and paginates with `limitToLast` + `endAt`.
- Clicking a gallery item fetches the full message from `kindlechat/messages/{messageId}` to show the large pixel art or play the full flipbook.
- Pixel-art saves from the gallery reuse `savePixelArtData()` with the current message cached in `window.galleryPixelArtData`; never put the base64 image URL into an inline `onclick` handler.
- `showPixelArtModal()` replaces `#generic-modal-content.innerHTML`, which destroys the default `#modal-message` and `#modal-btns` children. `showModal()` must rebuild those nodes and reset the generic modal's inline width/max-width before displaying another message.
- Both viewer modals reuse `#generic-modal-content` (a `.modal-box` with `padding: 20px`), so `showPixelArtModal()` and `showFlipbookModal()` must set `modalBox.style.padding = '0'` (hideModal/showModal reset it back to ''). Without this the flipbook viewer keeps the 20px modal padding.
- Chat-view pixel art and flipbook bubbles open the same gallery viewer via `openGalleryItem(msgId)` (it fetches the full message from `kindlechat/messages` and handles deleted messages). Inline `playFlipnote()` is now only used for the auto-play-on-render; clicking a flipbook thumbnail opens the modal.
- The moderation worker automatically writes the index entry when a pixel art or flipbook message is posted, and deletes it when a message is auto-deleted from a report.

### Files involved
- `workers/rekindle-moderate/worker.js` — writes/deletes index entries.
- `rtdb-social-rules.json` — security rules for `kindlechat/art_index`.
- `kindlechat.html` — gallery view reads from `art_index`.
- `scripts/backfill-art-index.js` — one-time migration to populate the index for existing art posts.

### Backfill

Existing pixel art and flipbook posts do not automatically appear in the index. Run the migration once:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/rekindle-socials-service-account.json
node scripts/backfill-art-index.js
```

### Important rule for future art features

Any new feature that posts pixel art or flipbooks to KindleChat must also write an entry to `kindlechat/art_index/{messageId}` with the same shape, or update the moderation worker to do it on the feature's behalf. Otherwise the gallery will not show those posts.

## Message Retention (2026-10-21)

`cleanupSocial` (Firebase scheduled function, `firebase-functions/social-cleanup.js`) deletes
KindleChat general messages older than **30 days**, always keeping the latest **50** messages. For
each deleted message it also removes `kindlechat/art_index/{messageId}` and every
`kindlechat/translations_by_lang/<lang>/{messageId}` entry in the same multi-path RTDB update, so
translations and the art gallery prune instead of orphaning. Candidate scans page the
RTDB keys with shallow `limitToFirst`/`startAfter` and decode the Firebase push-ID
creation time (RTDB rejects `orderBy`/`endAt` on shallow GETs); the latest 50 messages
are fetched with one `limitToLast` query. Message bodies/pixel art are never downloaded
just to get keys. DM messages are not touched. Full design and deploy/dry-run steps:
[social-cleanup.md](social-cleanup.md).

## KindleChat Pixel Art Duplicate Prevention

To stop users from reposting the exact same pixel art repeatedly in KindleChat, duplicate prevention is enforced both client-side and server-side.

### Client-side `postedToKindleChat` flag (`pixel.html`)

Each drawing in the user's manifest can carry a `postedToKindleChat: true` flag.

*   When a drawing is successfully posted to KindleChat, `postToPixelChat()` sets `item.postedToKindleChat = true` on the current manifest item and saves the manifest.
*   Before posting, `postToPixelChat()` checks the flag and shows a modal if the drawing has already been posted unchanged.
*   Any modification to the drawing (saved via `performSave()`) clears the flag to `false`, so the edited drawing can be posted again.
*   Translation key: `pixel.status.already_posted` — "This pixel art has already been posted to KindleChat. Modify it to post again."
*   Blank (all-white) pixel art is also blocked from posting. Use `pixel.status.blank` — "Blank pixel art cannot be posted."

### Server-side duplicate detection (`workers/rekindle-moderate/worker.js`)

*   Pixel art posts skip the text-only duplicate check (the placeholder text `"Shared a pixel art!"` would otherwise block different pixel art).
*   Instead, the worker hashes `body.grid_data` and checks `kindlechat/user_recent/{uid}/kindlechat_pixel_art/{hash}` for a 5-minute duplicate window.
*   After a successful post, the grid data hash is recorded under `kindlechat_pixel_art` for duplicate detection.
*   No RTDB rule changes are required: `kindlechat/user_recent/{uid}` is already writable by the social service account for any child path.

## Unicode Emoji Picker (`POPULAR_EMOJIS` in emojis.js)
`emojis.js` also defines `POPULAR_EMOJIS` (~120 curated `{emoji, name}` entries — deliberately trimmed to the most popular/wholesome set for the all-ages community: no edgy/gross, alcohol, anger, or money emojis) used by the KindleChat emoji picker (`initAsciiPicker()` in `kindlechat.html`). It is a **category object** (`{"Smileys": [...], "Hearts": [...], "Hands": [...], "Animals": [...], "Nature": [...], "Food": [...], "Fun": [...]}`), NOT a flat array — category keys become the picker sidebar tab labels. This is a **separate global from `ASCII_EMOJIS`** on purpose: the worker's `ASCII_EMOJI_ARTS` strip-list mirrors `ASCII_EMOJIS` only, so do NOT merge these arrays or the strip-list invariant breaks. Standard Unicode emojis do not trip omni-moderation the way ASCII art does, so they need no stripping.

How the picker works:
- The emoji categories are prepended to the picker as sidebar tabs (Smileys first = default active), built by merging each `POPULAR_EMOJIS` category into `pickerCategories`; all `ASCII_EMOJIS` categories are then flattened into ONE trailing tab labeled `っ◕‿◕)っ`. Emoji category tabs render an OpenMoji icon (the category's first emoji, `.emoji-tab` class, inverted on hover/active) instead of a text label — the category key is only used for the section id and `title` tooltip.
- The emoji section uses its own `.emoji-grid` (CSS Grid with `gap`, 48px cells / 32px images) and `.emoji-option` classes — do NOT reuse `.ascii-grid`/`.ascii-option` for emoji sections: `.ascii-grid>*+* { margin-left: 5px }` indents every wrapped row and has no vertical gaps, and the base `.ascii-option` styles (min-width, flex-grow, Courier font) fight the image cells. `.emoji-option img` also needs `image-rendering: auto` to undo the body's `image-rendering: pixelated` for smooth SVG scaling.
- Each option renders as an `<img src="openmoji/{file}">` looked up via `EMOJI_SVG_MAP` from `js/emoji-render.js` (the Kindle cannot render emoji glyphs). **Do not** call `renderEmojis()` on the picker container — the ASCII art sections contain chars ≥ U+2600 (☁, ♥, ✿) that are also in `EMOJI_SVG_MAP` and would get mangled into images.
- `insertAscii()` inserts the raw Unicode char for ASCII art, but for Unicode emojis it inserts an `<img class="composer-emoji">` (OpenMoji) — see the composer note below.
- **Entries must use bare codepoints WITHOUT the `FE0F` variation selector** (e.g. `"❤"` U+2764, not `"❤️"` U+2764 U+FE0F) — the auto-generated `EMOJI_SVG_MAP` keys are FE0F-less for these, so FE0F forms silently miss.
- After editing `emojis.js`, bump its `?v=` query in `kindlechat.html` (only page that includes it).

## KindleChat Composer Is `contenteditable` (Not a `<textarea>`)
The KindleChat message composer (`#msg-input` in `kindlechat.html`) is a `contenteditable` div, not a textarea, because a textarea can only hold plain text and Unicode emojis render as blank boxes on Kindle. Emojis live in the composer as real `<img class="composer-emoji" src="openmoji/..." alt="{unicode}">` nodes that flow inline with the text.

Invariants to preserve when touching the composer:
- **Never read/write `.value`** — it does nothing on a div. Read with `getComposerText()` (serializes childNodes: text → nodeValue, `<img>` → `alt`, `<br>`/`<div>` → `\n`), clear with `innerHTML = ''`, set plain text with `textContent = ...`.
- The `alt` attribute on composer emoji imgs is the source of truth for the sent Unicode char — `serializeComposer()` converts imgs back to `alt` text, so messages still send/render as before (and `renderEmojis()` in bubbles handles display).
- Paste is force-plain-text via a `paste` listener (`text/plain` only) — do not remove it or rich HTML (incl. foreign images) can enter the composer.
- Placeholder is CSS `#msg-input:empty:before { content: attr(placeholder) }`; an `input` listener normalizes a fully-empty composer to `innerHTML = ''` so `:empty` matches again. Because of this, `js/i18n.js` sets `data-i18n-placeholder` via `setAttribute('placeholder', ...)` (property assignment does not reflect to `attr()` on a div).
- Disabled state = `contentEditable="false"` + `.composer-disabled` class (managed by `setChatInputEnabled`), not the `disabled` attribute.
- `user-select: text` on `#msg-input` overrides the body's `user-select: none`, or the caret/selection breaks.

## OpenMoji Caching (sw.js + _headers)
`/openmoji/*` requests are cached at two layers so Kindles never re-download emoji icons:

1. **Service worker (`sw.js`)** — route `1b` serves `/openmoji/*` **cache-first** (not stale-while-revalidate): OpenMoji filenames are codepoint-addressed so content never changes, and SWR would waste a background revalidation request per icon. The ~115 picker icons (`EMOJI_ASSETS`, ~0.5MB) are precached at install (best-effort per-file so one flaky icon can't fail the whole install); any other emoji first seen in a message is runtime-cached on demand via `cache.put`. Do NOT precache the whole 19MB openmoji/ dir (64MB Kindle global cache limit).
2. **HTTP headers (`_headers`, Cloudflare Pages)** — `/openmoji/*` gets `Cache-Control: public, max-age=31536000, immutable`, covering first visits before the SW installs (Pages' default is `max-age=0, must-revalidate`, which forces a revalidation round-trip per file per session). The same file also sets: `/sw.js` → `no-cache` (SW updates must never stall), `/fonts/*` → immutable year, `/locales/*` → 1 hour, and global `X-Content-Type-Options: nosniff`. Do NOT long-cache `/js/*` or HTML — most JS has no `?v=` buster, so users would be stranded on stale code.

**Regeneration rules:** when `POPULAR_EMOJIS` changes, regenerate `EMOJI_ASSETS` in `sw.js` (derive filenames from `EMOJI_SVG_MAP`); if the openmoji/ art itself is ever regenerated (library upgrade, same filenames new content), bump `CACHE_NAME` so clients drop the stale icons.

## Repetition / Flood Spam Guard (2026-10-20)

Built after a user flooded a dead chat for ~30 minutes (2026-10-19 23:01–23:21 JST) with `hello`, `hello hello hello`, `llo hello hello`, `hellllooooo`, `hhhh…eeee…llll…oooo`, `hi hi hi hi bhi hi…`, `aaaa…` and `ima njot stop spamming…`. 47 messages from one account, nothing else in the chat.

**Why the existing checks missed it:** the exact-duplicate check (`checkUserRecentContent`) was returning "no duplicate" for every message. `kindlechat/user_recent` had **no entries newer than 2026-09-21** — one month stale — across all 111 users, including the spammer, even though the same request had just written `server_rate_limits/{uid}/kindlechat` successfully. The `user_recent` record/cleanup calls ran *after* the response was returned (fire-and-forget, no `ctx.waitUntil`), so they were being dropped. Repeating `hello` 48 s apart therefore passed.

**Design (and the rule to keep):** the guard must not add Firebase reads or writes. The rate-limit bucket is already read and written once per message, so the repetition state rides inside it:

```text
kindlechat/server_rate_limits/{uid}/kindlechat
  { tokens, lastRefill, updatedAt,
    rep: "1792422156000:2741339713:261238937:261238937|..." }   // last 4 message shapes, newest first
```

Each entry is `<timestamp>:<textHash>:<dominantHash>:<tokenHashes>` — hashes only, never message text (≤ ~350 bytes). Because the old `user_recent` check+record+cleanup are removed from the chat path, posting a message now costs **2 RTDB ops instead of 5**.

**Matching (`chatTextShapes` + `evaluateChatRepetition`):**
1. Normalise: lowercase, strip non-letter/digit, drop `@mentions` (conversation context, not content).
2. Collapse character runs (`hello`/`hellllo`/`hhhhhh` → `helo`) and de-duplicate words.
3. `dominant` = the word with the plurality if it is ≥ half of the words (or the message is a single word). Single-character dominants are tagged `#x`, and character dominance is measured on the **un-collapsed** text: `aaaa…saaaa` (120 chars) must become `#a`, not the three-letter word `asa`. That rule is what catches letter-mash spam.
4. Two messages match when their dominants are equal or their token sets have Jaccard ≥ 0.5 (`hi hi hi` vs `hi hi hi bhi hi`). Dominant matching is what stops junk words from diluting Jaccard.
5. **Block** when the 2nd matching shape is already in the 10-minute window (so a user gets two near-identical messages, the third is rejected) or when the same text repeats within 5 minutes. Response: `429 { allowed:false, error, retryAfter }`.

Blocked attempts are still recorded (the evaluation runs before the POST is rejected), so hammering send cannot outlast the window — it just extends it and burns rate-limit tokens.

**Measured behaviour** on the real transcript (`scripts/test-chat-spam.js`): 14 of the 27 flood lines blocked, starting at the 3rd `hello` variant and covering the entire "hello loop"; the substantive lines (`im not gonna stop saying…`, `ima njot stop spamming…`, the sign-off) still pass. Replaying 500 real messages from a normal 3-hour session produced **3 blocks, all exact duplicates** (`k.`, `Hi`, `¯\_(ツ)_/¯`) — no false positives from the near-repeat rule. An earlier content-agnostic flood cap (N messages per minute) was rejected because real users in that session hit 6 messages/minute and 17 per 5 minutes.

**Files:**
- `workers/rekindle-moderate/worker.js` — `consumeRateLimitToken(uid, contentType, accessToken, spamOpts)` now evaluates and persists `bucket.rep`; `evaluateChatRepetition()` / `chatTextShapes()` above the legacy rate limiter.
- `js/spam-guard.js` — client mirror (`window.rekindleChatSpamCheck`, `window.rekindleRecordChatMessage`), localStorage key `rekindle_chat_recent_sent`. **KEEP IN SYNC** with the worker (same convention as `js/promo-ban.js`).
- `kindlechat.html` — includes `js/spam-guard.js?v=1`, pre-send check in `sendMessage()`, records on success in `doSendMessage()`, and shows the worker's `result.error` when `allowed === false` (the old code always replaced it with a generic "Please wait N seconds").
- `scripts/test-chat-spam.js` — unit tests for both mirrors (`node scripts/test-chat-spam.js`). Importing `worker.js` from Node works because Node detects the ESM syntax; the three pure helpers are exported for the test only.

**Deploy:** the guard is worker-side, so it is not live until the worker is redeployed (`cd workers/rekindle-moderate && npx wrangler deploy`). The client mirror ships with the Pages build.

**`kindlechat/user_recent` is retired (2026-10-20).** Nothing reads or writes it any more: the chat guard uses the rate-limit bucket, and the old per-type duplicate checks for topics / topic comments / neighbourhood posts & comments were deleted along with `checkUserRecentContent()`, `recordUserRecentContent()`, `cleanupUserRecentContent()` and `rtdbSocialPutSimple()` — they spent one RTDB read per post and could never match (nothing had recorded since 2026-09-21). Do not bring the pattern back unless the writer is awaited (`ctx.waitUntil()` when it runs after the response); a fire-and-forget writer is exactly what killed it. The stale RTDB node (111 users, ~175 entries) and its `rtdb-social-rules.json` block are still there and harmless; delete the node if you want the storage back.

## KindleChat Direct Messages (2026-10-20)

DMs are back, but on a new, server-written design. **Everything lives in the `rekindle-socials` RTDB** (`socialRtdb` in `kindlechat.html`); never the primary `rekindle-dd1fa` database.

### Why the old DMs were not brought back

The previous implementation used a Firestore `rooms` collection. `room` create/update was `allow create, update: if request.auth != null`, so any signed-in user could add themselves to another conversation and read it, and messages were written directly from the browser (no moderation). That collection is empty today and must stay denied; do not re-add `rooms` rules or migrate it.

### Product rules

- Only ReKindle+ accounts (`payload.pro === true` from the server-computed social token) may **start** a conversation; `payload.ageVerified === true` is also required.
- Any age-verified user can receive a request. Recipients (including non-Pro) may accept/decline/block and reply once accepted.
- First contact is one moderated request message (≤300 chars). The recipient must accept before the thread opens.
- Text only, no links, no pixel art/flipbooks, no translations. Messages ≤1,000 chars.
- A declined pair can never restart (deterministic thread ID + permanent state). A block is reversible, but only by the person who set it — see [Unblocking](#unblocking-2026-10-25).
- Safety actions (accept/decline/block/unblock) are exempt from the timeout check and the kill switch.

### Data model (social RTDB)

```text
kindlechat/dm_threads/{threadId}
  participants: {uidA: true, uidB: true}
  requestedBy, status: pending|accepted|declined|blocked
  createdAt, acceptedAt?, declinedAt?, blockedAt?, blockedBy?
  blockedFromStatus?   # status the block replaced (pending|accepted|declined)
  unblockedAt?         # last time a block was lifted

kindlechat/dm_messages/{threadId}/{messageId}
  uid, text, timestamp

kindlechat/dm_user_threads/{uid}/{threadId}
  otherUid, requestedBy, status, blockedBy?
  lastMessageAt, lastMessageUid, lastReadAt   # no preview text (privacy)

kindlechat/dm_prefs/{uid}/allowRequests       # owner-writable boolean
kindlechat/dm_blocks/{uid}/{blockedUid}: true  # worker-written

kindlechat/config/dm_enabled         # production kill switch (default false)
kindlechat/config/dm_beta_enabled    # beta.rekindle.ink only (default false)
```

`threadId = 'dm_' + [uidA, uidB].sort().join('_')`. The client never supplies a thread ID for a new conversation, and every action re-checks membership server-side.

### Worker API (`workers/rekindle-moderate/worker.js`)

| Type | Who | Notes |
| :--- | :--- | :--- |
| `dm_request` | Pro + age-verified | kill switch, 300-char limit, URL/promo/`dih`, OpenAI moderation, `dm_request` bucket, max 3 pending outgoing, block and `allowRequests` checks, `dm_exists` handling |
| `dm_message` | participant | kill switch, accepted status only, 1,000-char limit, URL/promo/`dih`, OpenAI moderation, `dm` bucket + repetition guard |
| `dm_accept` | recipient | `pending → accepted`, ETag write |
| `dm_decline` | recipient | `pending → declined`, permanent |
| `dm_block` | participant | `blocked`, records `blockedFromStatus` + `dm_blocks/{caller}/{other}`, both index rows updated |
| `dm_unblock` | blocker only | deletes `dm_blocks/{caller}/{other}` and restores the pre-block status; see [Unblocking](#unblocking-2026-10-25) |

Rate limits: `dm` = 8 tokens / 8 s; `dm_request` = 5 tokens / 2 h plus the hard 3-pending cap. DM text is never written to `automod_log` (`storeText:false`); categories only.

Reports: `contentType: 'dm_message'` is immediately auto-deleted on the first report. The worker **derives** the path/author/snapshot from the social RTDB after proving the reporter is a participant, and attaches a report-scoped `dmContext` (last 10 messages) for moderators. There is deliberately **no** moderator read rule on `dm_messages`; the context is stored only on the report. Discord delete resolves the thread from the report’s `contentPath`.

### Client (`kindlechat.html`)

- Third `Messages` tab, hidden until `dm_enabled`/`dm_beta_enabled` is true. Unread dot only; inbox shows the 50 most recent threads (no previews).
- Thread view reuses the existing composer (emoji picker works), but hides the Pixel Art/Flipbook buttons to keep DMs text-only.
- Separate `renderDmMessage()` — no reactions, replies, translations, art gallery or admin reprocess hooks.
- The client only writes `dm_user_threads/{uid}/{threadId}/lastReadAt` and `dm_prefs/{uid}/allowRequests`. All thread/message content is written by the worker.
- One-time safety modal (localStorage `rekindle_dm_safety_ack`), plus a per-request banner. Settings has “Allow message requests”.
- The blocked banner and the thread header's Block button become **Unblock** for the blocker only (`dmAction('unblock')` → `dm_unblock`), behind the same confirm modal pattern as Block. The blocked party keeps seeing "This conversation is closed."
- Listener pattern: inbox `limitToLast(50)` on `dm_user_threads/{uid}`; thread `limitToLast(50)` on messages with `child_added`, plus **`child_removed` on the bare thread ref** so window-slide events do not remove paginated messages. Older messages paginate with `endAt`.

### Cost / performance

Sending a DM costs roughly 6 RTDB ops (thread GET, rate-limit GET+PUT, message POST, two index PUTs) plus the moderation call. A request costs ~10 ops (plus the pending query). Inbox/thread payloads are small and preview-free; keep it that way.

### Kill switch and rollout

```bash
node scripts/set-dm-flag.js --status
node scripts/set-dm-flag.js --env=beta --enabled=true
node scripts/set-dm-flag.js --env=prod --enabled=true
```

Deploy order: worker → `npm run deploy:rules:social:rtdb` → Pages → enable beta → two-account beta test → enable prod. The client hides the tab on the next load; the worker rejects new sends within 60 s (isolate cache). Existing data and rules are untouched, but the UI stays hidden until the switch is re-enabled (the kill switch is for stopping new contact, not for granting emergency data access).

### Tests / admin

- `node scripts/test-dm.js` (also in `npm test`) covers thread IDs, report-path parsing, rule invariants (no client content writes), and asserts client DM reads/writes use `socialRtdb`.
- `admin/cleanup_user.js` and `admin/nuke_user.js` purge DM threads/messages/inbox rows/blocks with the service account. The moderation console intentionally cannot read DM threads; it shows only report-scoped context.

### Unblocking (2026-10-25)

Blocks were terminal: `dm_block` overwrote `status` with `blocked` and nothing could ever move it back, so one accidental tap removed a conversation permanently (only a moderator editing RTDB could undo it). The fix keeps the block just as strong but makes it **reversible by the person who set it** — never by the blocked party.

**Recording the previous state.** `dm_block` now stores `blockedFromStatus = thread.status` before writing `blocked`, because RTDB has one status field and the old value is otherwise lost. For threads blocked before this field existed, `dmStatusAfterUnblock()` falls back on `acceptedAt` → `accepted`, `declinedAt` → `declined`, else `pending`.

**`dm_unblock` (worker action, `{ type: 'dm_unblock', threadId }`):**

1. Same participant check as the other safety actions; it is **not** behind the Pro check or the kill switch, and it is in `TIMEOUT_EXEMPT_TYPES`.
2. If the thread is not blocked → `200 { success, status }` (idempotent; a retry costs one GET and writes nothing).
3. If `thread.blockedBy !== uid` → `403 "This conversation is closed."` — the same generic text the blocked party already sees, so the action never reveals **who** blocked whom.
4. Deletes `kindlechat/dm_blocks/{uid}/{other}` first. Order matters: if a later write fails, the block is still enforced by the thread status, never silently lifted without the record.
5. Reads the reverse entry `dm_blocks/{other}/{uid}`. `dm_block`'s idempotent branch lets the blocked party block back, so if that entry exists the thread stays `blocked` with `blockedBy` switched to them (and `blockedFromStatus` preserved for their eventual unblock). A failed read fails closed → treated as blocked. Otherwise the status is restored from `blockedFromStatus`, `blockedBy`/`blockedAt`/`blockedFromStatus` are removed, and `unblockedAt` is stamped.
6. Writes both inbox rows through `writeDmStatusToIndexRows()` (the same helper the other transitions now use), deleting `blockedBy` so neither inbox keeps showing "You blocked this person".

**Restored states.** `accepted` reopens the conversation (composer enables, banners hide). `pending` returns the request to the recipient's inbox, where Accept/Decline/Block are offered again — deliberately **not** straight to `accepted`, because that would let a requestor skip the acceptance gate by getting blocked and unblocked. `declined` stays declined: unblocking removes the block record but does not resurrect a declined request.

**Client (`kindlechat.html`).** `updateDmBanner()` appends an **Unblock** button to the "You blocked this person…" banner; the header's `#dm-block-btn` becomes Unblock too (`dmHeaderBlockAction()` decides by `status === 'blocked' && blockedBy === uid`, and the i18n key/label are switched together). `dmAction('unblock')` confirms first (`kindlechat.dm.confirm_unblock`), then applies `result.status`/`result.blockedBy` to the row, refreshes the header/banner/composer/inbox, and focuses the composer when the thread reopens. Unlike Block it does **not** jump back to the inbox — you stay in the thread you just reopened. The inbox listener now also calls `updateDmHeader()` so a status that changes remotely updates the header button.

**No rules change:** `dm_threads` and `dm_blocks` writes remain service-account-only in `rtdb-social-rules.json`; the thread `.validate` already accepts every restored status. Unblock is a worker-only action, so the client still writes no DM content.

**Deploy:** worker first (`cd workers/rekindle-moderate && npx wrangler deploy`), then the Pages build for the client. Until the worker is redeployed, the new client button gets the worker's "Unknown content type" error (unblock is a new `type`), so deploy the worker before the client.

**Tests:** `scripts/test-dm.js` covers `dmStatusAfterUnblock()` (all three prior statuses, the legacy timestamp fallback, an unknown `blockedFromStatus`, null) and asserts the wiring: `dm_unblock` handled, `blockedBy !== uid` guard, block-record deletion, `blockedFromStatus` recorded, timeout exemption, both rows refreshed, and the client/locale keys present.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).

## 2026-10-20: chat audit fixes (`docs/audit-2026-10-20.md`)

- **Pagination uses the cache it already fills.** `loadOlderMessages` stored each message in
  `generalMsgData[id]` and then did `generalChatRef.child(id).once('value')` to render it - up to
  25 redundant RTDB GETs per page. It now renders from `generalMsgData[id]`.
- **Flipnotes animate one at a time.** Every rendered flipnote started a 6 fps `setTimeout` chain
  that never stopped, and each reaction/translation re-render re-armed it. `activeFlipnoteId` +
  `stopFlipnote()` cap it to one, and `pagehide`/`visibilitychange` stop it.
- **Send guard:** the 3 s "failsafe unlock" (`isSendingMessage = false`) fired while a slow
  moderation POST was still in flight and allowed a duplicate post; it is now 30 s. Every settle
  path still calls `resetSendState()`.
- **Deleted the dead send path.** `sendGeneralMessageViaWorker()` / `sendGeneralMessageToRTDB()`
  had no callers and wrote straight to `kindlechat/messages`, bypassing the moderation worker,
  the rate limit and the repetition guard. `doSendMessage()` is the only send path.

## 2026-10-21 backlog pass

- **Translation arrivals patch the bubble** (`applyTranslationToRenderedMessage`) instead of
  calling `renderMessage` for every message in the live window: sets `data-original`/
  `data-translated`, rewrites the bubble text, and appends the Show Original toggle. Falls back to
  a full render only when the bubble is missing (art/flipnote/special messages).
- **ASCII picker scroll spy** caches the sidebar item list, throttles to 120 ms, only toggles
  classes that change, and scrolls the sidebar with `scrollTop` instead of a smooth
  `scrollIntoView` animation that re-entered the handler.
- **Send token** uses the cached `getIdToken()` and force-refreshes only when the worker answers
  401/403 (one retry). The same pattern is in `neighbourhood.html` (comment + post) and
  `topics.html` (comment).

## 2026-10-21: DM avatars (bubbles + sidebar) + split (list | conversation) layout

DMs only; all changes are in `kindlechat.html`.

### DM profile pictures (same as the general chat)

`renderDmMessage()` used to append the bubble straight to `.msg`, so DM threads had no avatars while the
general chat showed a 32×32 canvas beside every bubble. It now builds the same `.msg-row` structure as
`renderMessage()`:

```html
<div class="msg other">
  <div class="msg-meta">name · time</div>
  <div class="msg-row">
    <canvas class="msg-avatar" id="dm-avatar-{msgId}" width="32" height="32"></canvas>
    <div style="display:flex; align-items:center; min-width:0">
      <div class="report-btn">!</div>   <!-- not on your own messages -->
      <div class="msg-bubble">…</div>
    </div>
  </div>
</div>
```

- `.msg.self .msg-row { flex-direction: row-reverse }` (existing CSS) puts your own avatar on the right,
  exactly like the general chat.
- `resolveDmAvatar(uid, canvas)` draws the `uid` hash immediately (blank canvas never shows), then
  `window.rekindleFetchUserCard(rtdb, uid, …)` swaps in `card.customAvatar || card.avatarSeed || uid`.
  `rtdb` is the **primary** project (`user_cards`), same source the general chat reads; theme.js caches the
  lookup, so a thread costs no extra reads.
- The card callback checks `canvas.parentNode` before redrawing: paging/thread switching can remove the
  bubble while the lookup is in flight.
- The draw is deferred with `setTimeout(…, 0)` because paginated renders (`returnOnly === true`) are
  inserted into a fragment *after* `renderDmMessage` returns; drawing immediately would find no canvas.
- The report button moved from its own row under the bubble into the content div (between avatar and
  bubble), matching the general chat's action-button position.
- Do **not** fork `drawAvatar()` for DMs: the one copy already renders float `customAvatar` grids as
  grayscale (see [avatars.md](avatars.md)). It now also accepts the canvas **element** as its first
  argument (an id still works) so callers can draw while detached — the bubble helper and the sidebar
  cache below both rely on that.

### Sidebar (conversation list) avatars

Every `#dm-list` row starts with the same 32×32 avatar (`canvas.dm-row-avatar` → `img.dm-row-avatar`
once cached), followed by the existing name/status block and unread dot. `makeDmRowAvatar(uid)`:

1. If `dmRowAvatarCache[uid]` holds a data URL, returns an `<img src=…>` — no drawing at all.
2. Otherwise creates a 32×32 canvas, draws the `uid` hash immediately (works detached), and asks
   `rekindleFetchUserCard` for the card. When it answers it redraws with
   `customAvatar || avatarSeed || uid` and stores `canvas.toDataURL()` in the cache.
3. Skips caching only when the row was rebuilt **and** no card came back (`!card && !canvas.parentNode`),
   so a transient hash avatar can't shadow the real one for the session.

Why the cache: `renderDmInbox()` rebuilds all rows on every inbox update (now also while a thread is
open in the split view), and one `drawAvatar()` costs up to ~256 `fillRect` calls. The Kindle runs a
JIT-less V8, so the first render pays for the draws and every later render reuses the PNG data URLs.
`dmRowAvatarCache` is declared with the other DM state and cleared on sign-out alongside `dmNameCache`.

The sidebar column is **230px** (not 210px) so a 36px avatar + 10px gap still leaves room for a full
15-character username before the ellipsis, plus the unread dot.

### Split layout: names left, conversation right

The Messages tab can now show the conversation list beside the open thread:

```text
#app-layout.dm-split           (display: grid; grid-template-columns: 230px 1fr; rows: auto 1fr)
├─ .room-header                (grid-column: 1 / -1)
├─ #messages-view              (col 1 — dm-toolbar + #dm-list)
├─ #chat-view                  (col 2 — DM thread + composer; the general chat's usual home)
└─ #dm-empty-pane.visible      (col 2 — placeholder until a conversation is picked)
```

- `applyDmLayout()` adds/removes `dm-split` and the pane's `visible` class. It runs from
  `openMessagesView`, `openDmThread`, `openGeneralChat`, `openGalleryView`, `toggleFullScreen`, the
  debounced (150 ms) `resize` listener, and the sign-out reset.
- **Breakpoint:** `DM_SPLIT_MIN_WIDTH = 600`, measured on `.window.clientWidth`, **not** the viewport —
  the window is centered, capped at 900px, and fullscreen/zoom change the usable layout width (the
  Kindle can be 800px wide with a 760px window, or 600px wide in portrait).
- Below the breakpoint the original single-pane flow is unchanged: `#messages-view` is the inbox,
  opening a thread hides it and shows `#chat-view`; `openMessagesView` closes the open thread, and
  `applyDmLayout` removes `active` from `#messages-view` when it narrowed while a thread was open.
- Above it, `openMessagesView` **keeps** the open thread (`#chat-view` stays `display:flex`) and
  `openDmThread` keeps `#messages-view.active`, so the list remains in the left pane.
- Split-only chrome: `#dm-back-btn` and `.dm-toolbar-title` are hidden (`Back` is meaningless when the
  list is visible), `.dm-new-btn` goes full width, and `.dm-row.active` (gray background + 4px inset
  bar) marks the open conversation via `markActiveDmRow()`.
- `renderDmInbox()` saves/restores `#dm-list.scrollTop`: in split mode the inbox listener re-renders the
  list on every thread update, which would otherwise jump the sidebar to the top.
- The placeholder uses `data-i18n="kindlechat.dm.select_conversation"`; the key is in `locales/en.json`
  only (missing keys leave the inline English text, per `applyTranslations`). `#dm-empty-pane` is a direct
  child of `#app-layout` because it needs its own grid cell.
- CSS Grid (not flex) for the panes: Chromium 75 has no flex `gap` (AGENTS.md §1).

**Verification:** static harness screenshots at 800×1000 (grid computed `230px 530px`, window 760px) and
500×800 (single pane), plus a real-page smoke test that called `openMessagesView()`/`openDmThread()` with
fake inbox rows: `#messages-view` at x=20 w=230, `#chat-view` at x=250 w=530, 3 `.msg-avatar` canvases,
`#dm-empty-pane` hidden, `#dm-back-btn` `display:none`. A second smoke test confirmed the sidebar
avatars: first render `CANVAS,CANVAS` with 2 cache entries, an immediate `renderDmInbox()` produced
`IMG,IMG` with `src="data:image/png;…"`, and the bubbles still rendered their own avatars.

**Testing gotcha:** forcing `#app-layout { display:flex !important }` in a test/stub (e.g. to counter the
guest-mode `display:none`) silently overrides the split grid and stacks the panes — hide the guest overlay
and reset `style.display` instead.

## Late auth restore must replace the guest screen (2026-10-24)

**Symptom:** users reported "KindleChat says I need to be logged in even though I
am logged in" (2026-10-22, 10-23, 10-24). The dashboard link can open chat while
Firebase is still restoring IndexedDB auth. The old flow showed the guest overlay
after a 2.5 s grace, then **latched** `authInitHandled = true`; the
`onAuthStateChanged` handler returned early forever, so an auth restore at 3 s+
left the guest overlay up until the user reloaded.

**Fix (2026-10-24):** `authInitHandled` now only marks the first decision. A
signed-in `onAuthStateChanged(user)` always calls
`activateKindlechatForUser(user)`, which is idempotent per uid, hides
`#guest-overlay`, restores `#app-layout`, and enters `handleKindlechatAuth()`.
The 2.5 s/6 s timers still show the guest screen, but do not prevent recovery;
the 6 s timer also stops if `guestScreenShown` is already true. Signing out
after a successful load clears `activeAuthUid` and shows the guest screen again.
Keep this recovery path when changing the auth gate — the grace period is for
slow e-ink auth, not a permanent latch.

## Pixel-art captions are alt text (2026-10-24)

The Post to KindleChat confirm modal (`pixel.html`) now has an optional
`#pixel-caption-input` (200 chars). Its value is sent as the message `text`
(falling back to `pixel.status.shared`), so it goes through the existing
moderation/URL/promo checks with no new worker field. KindleChat renders it as
the visible caption and as the `<img alt>` in both the chat bubble and
`showPixelArtModal()`. The gallery index already stores `text`, so no migration
or rule change was needed; keep using `text` rather than adding an unmoderated
`alt` field.

## Reaction set (2026-10-24)

`FONT_REACTIONS` gained `angry` and `wave` (SVGs in `emojis.js`'s
`REACTION_SVGS`). The picker wraps (`flex-wrap`) with a 320 px cap so ten
options fit a 600 px window. Reaction keys are not whitelisted by the RTDB
rules (only `reaction` + `username` are validated), so no rules change was
needed. Bump `emojis.js?v=` in `kindlechat.html` whenever this list or the SVGs
change.

## Language detection, gating and auto-translation (2026-10-26)

The stored-translation pipeline is dead (see [integrations.md](integrations.md#translation-providers-googles-gtx-endpoint-is-dead-2026-10-26)):
`workers/rekindle-translate` scraped Google's gtx endpoint, which now blocks every client, so
`kindlechat/translations_by_lang/*` stopped on 2026-10-19.

Every social write now carries a **client-detected `lang`**, and readers only see a Translate
link when that language differs from their own. The same language tag drives automatic
on-view translation.

### Detection bundle

* **`js/lang-detect.js`** is a generated bundle of the [Efficient Language Detector](https://github.com/nitotm/efficient-language-detector-js)
  (ELD 2.1.0, Apache-2.0, see `licenses/efficient-language-detector-*`) plus a small chat
  lexicon. It bundles ELD's **Medium** n-gram database for the eight Latin-script UI languages
  (`en, de, es, fr, it, pl, pt, vi`); `ru`, `zh`, `ja`, `ko`, `ar`, `he`, `el`, `th` and `hi` are
  settled by Unicode script before ELD runs. Size: **~366 KB raw / ~119 KB gzip**. The XML/HTML
  header in the file carries the attribution; do not delete it.
* **Regenerate with `npm run build:lang`** (`scripts/build-lang-detect.js`, entry
  `scripts/lang-detect-entry.js`). `eld` is a devDependency only; the generated file is committed
  so production deploys do not need the 9 MB package. Bump `DETECT_URL` in `js/post-language.js`
  (and `js/post-language.js?v=` in the pages) after regenerating, otherwise the immutable edge/SW
  cache keeps the old bundle.
* **Lazy loading.** `js/post-language.js` injects the bundle when a composer is focused and again
  4 s after page load. Do not add it as a parser-blocking `<script>`: that is 119 KB on every
  social page for readers who never post. If the bundle is not ready, the send path falls back to
  the old stopword heuristic and still sends a `lang`; the message is then less accurately tagged.
* **Accuracy.** ELD Medium was 100% on the accented 8-language sentence corpus and the chat
  lexicon pins short greetings where ELD alone is weak (`merci` → it, `hello` → it). The lexicon
  also handles unaccented typing (vi/pl). `scripts/test-lang-detect.js` is the regression guard.
* **Lingua is not used.** Its browser story is a WASM build whose models are far larger than a
  Kindle page budget; ELD is pure JavaScript, ES2015, and no network call.

### Stored schema

The moderation worker is still the only writer for this content. It validates the client code
against `DETECTED_LANGUAGE_CODES` (`addDetectedLang()`), normalises `pt-BR`/`pt_BR` to `pt`, and
omits the field when the code is missing or unknown:

| Path | Field |
| :--- | :--- |
| `kindlechat/messages/{id}` | `lang` |
| `kindlechat/dm_messages/{threadId}/{id}` | `lang` |
| `topics/{id}` | `lang` (title + subheading + poll) |
| `topics/{id}/comments/{id}` | `lang` |
| `neighbourhood_posts/{id}` | `lang` |
| `neighbourhood_posts/{id}/comments/{id}` | `lang` |

`editPost()` and the topic edit path write directly to Firestore, so they recompute `lang`.
Messages that predate this change have no `lang`. They keep the Translate link and are
auto-detected on view: `translate-client.js` waits for the lazy detector, and if the result is the
reader's language (or unknown/ASCII art) it just retires the now-pointless link; if it is foreign it
translates and shows **Show Original** like any tagged message.

### Gating and automatic translation

* **Button gating.** Each render compares the stored `lang` with the reader's language
  (`getEffectiveTranslationLang()` in chat, `userLang` in Neighbourhood, the resolved UI language
  in Topics). The Translate link is rendered only when the codes differ **and** the message is not
  the reader's own and `showTranslations` is on. Unknown `lang` keeps the link visible until the
  on-view detection confirms the language, at which point a same-language message's link is removed.
* **Do not show the link for same-language content.** This was the point of the change: the old
  on-demand link appeared on every foreign-looking bubble, including English messages read by
  English readers.
* **Auto translation.** `js/translate-client.js` exposes `autoTranslate({id, text, source,
  target, apply})`. It runs one MyMemory request at a time, 350 ms apart, with a **24-request /
  20,000-character** ceiling per page view, stops after a `budget` error or three consecutive
  provider failures, and caches by exact text in `sessionStorage`. Pass `source: 'auto'` when the
  message has no stored `lang`; the queue waits for `js/lang-detect.js`, detects the source, and
  treats same-language/unknown text as a no-op (it calls `apply(original)` so the page can retire
  the link) without spending the request budget. Pages keep their own translation map
  (`langTranslations`, `dmTranslations`, `postTranslations`, `commentTranslations`,
  `topicTranslations`) so a re-render is free and the **Show Original** toggle works.
* **Why the queue matters.** A feed render with 30 foreign posts must not fire 30 API calls in
  one paint on a Kindle. The queue also leaves the explicit link in place as the fallback.
* **KindleChat's `showTranslations` setting is the opt-out** for both the link and auto
  translation. Neighbourhood/Topics have no setting and always auto-translate foreign content.
* **Manual translation uses the stored source**: `requestTranslation`/`requestPostTranslation`
  pass `data-lang` instead of `'auto'`, so MyMemory gets an explicit pair rather than re-guessing
  a short message.
* `fireTranslationRequest()` stays retired. Do not re-enable the server fan-out without a keyed
  provider: it fired up to 4 Worker requests and 4 forced `getIdToken(true)` refreshes per message.
* `langTranslations` and the scoped `translations_by_lang/<lang>` listener are unchanged, so any
  future server-side translation still appears without a client change.

### UI surfaces covered

* KindleChat general chat: link + auto.
* KindleChat DMs (messages and the first DM request): link + auto, with `dmTranslations` so a
  thread re-render keeps the translation.
* Neighbourhood posts: link + auto (`postTranslations`).
* Neighbourhood comments: link + auto (`commentTranslations`).
* Topics comments: link + auto (`topicTranslations`). Topic titles/subheadings are detected and
  stored, but their translation UI is not wired yet; comments are the message surface.

### Tests

* `scripts/test-lang-detect.js` — 49 sentences, 17 greetings, 9 script languages, normalisation,
  and a no-network assertion on the bundle.
* `scripts/test-social-language.js` — every worker write persists `lang`, every client send path
  sends it, every render gates on it, every page loads the lazy detector.
* `scripts/test-translate-auto.js` — serial queue, same-language skip, cache reuse, budget stop.
* `scripts/test-translate-detect.js` — the old heuristic still works when the bundle is absent
  (Translator app, legacy on-demand link).
