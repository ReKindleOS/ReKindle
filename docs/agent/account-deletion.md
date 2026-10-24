# Permanent Account Deletion (`deleteAccount`)

Added 2026-10-24. Read before changing `settings.html`'s Account section,
`firebase-functions/account-deletion.js`, `account-deletion-lib.js`, the social
RTDB indexes, or anything that stores user-owned data.

## What it is

A **Delete Account** button in the Settings Account section. The user
reauthenticates with their password and types their username; a Cloud Function
(`deleteAccount`, v2 callable in the **primary** project) then removes the
account and its content from both Firebase projects and Firebase Storage.

This is an **immediate, permanent** deletion. There is no grace period and no
"restore account" path; the Auth record is deleted, so the username becomes
available for registration again.

Why server-side: clients cannot delete KindleChat messages, DM threads, social
reports, moderator timeouts, Storage files or an Auth record (rules deny those
writes), and a browser-side sweep dies when the tab closes.

## Files

| File | Role |
| :--- | :--- |
| `settings.html` | Danger row, confirmation modal, reauthentication, callable invocation, success screen |
| `firebase-functions/account-deletion.js` | Destructive I/O orchestration (both projects + Storage + Auth) |
| `firebase-functions/account-deletion-lib.js` | Pure rules: confirmation, recent-login window, RTDB path builders, summary |
| `firebase-functions/index.js` | Exports `deleteAccount` with `timeoutSeconds: 540`, `memory: "512MiB"` |
| `scripts/test-account-deletion.js` | Pure helpers + handler precondition tests (runs in `npm test`) |
| `rtdb-social-rules.json` | RTDB indexes used by the deletion queries |

## Callable contract

`POST` via `firebase-functions` callable, primary app.

* **Auth:** required (`request.auth.uid`).
* **Data:** `{ confirmation: string }` — the user's username. The browser never
  sends a uid, path or document list.
* **Preconditions:**
  1. `SOCIAL_SERVICE_ACCOUNT_JSON` must be configured (otherwise the sweep
     cannot reach the social project, so the function refuses).
  2. `auth_time` must be within **10 minutes** (`RECENT_AUTH_MAX_SECONDS`). The
     client calls `reauthenticateWithCredential()` then `getIdToken(true)` so
     the token carries the fresh claim.
  3. `confirmation` must equal the account's email handle
     (`alice@rekindle.ink` → `alice`), compared case-insensitively with
     surrounding whitespace ignored. If the handle is empty it falls back to
     `users_public/{uid}/username`. An empty expected username always fails
     (never turn the check into a no-op).
* **Returns:** `{ deleted: true, counts: {...} }`.
* **Error details:** `failed-precondition` + `details.code ===
  'recent-login-required'` when the login is stale; `permission-denied` for a
  wrong confirmation; `deadline-exceeded` if the 8-minute budget is exhausted;
  `internal` for an incomplete sweep. The client maps these to friendly text.

### Password / recent-login threat model

The page verifies the password with `reauthenticateWithCredential()` and then
forces `getIdToken(true)`; the function requires `auth_time` within 10 minutes.
`auth_time` is a *fresh-sign-in* proof, not a server-side password check: a
session that signed in moments ago can call the function directly from devtools
without the password prompt. Server-side password verification would require
calling Identity Toolkit `accounts:signInWithPassword`, but the project's public
web API key is HTTP-referrer restricted (`API_KEY_HTTP_REFERRER_BLOCKED` from a
server), so there is no working key in the current config. Keep the 10-minute
window; if a non-referrer-restricted key is ever provisioned, verify the
password server-side in `deleteAccount` before touching data.

## Deletion order and safety

1. Read identity + `stripeCustomerId` (before the user document is deleted).
2. Best-effort Stripe cancellation (only when `STRIPE_KEY` is set).
3. Social Firestore (topics, comments, posts, comments).
4. Social RTDB (chat, art index, DMs, reports, profiles, rate limits).
5. Primary Firestore (user tree, leaderboards, runs, audit, uploads).
6. Primary RTDB (profiles, presence, timeouts, suggestions, freewrite,
   matchmaking) + social simple nodes.
7. Firebase Storage `users/{uid}/**`.
8. Social-project Auth user.
9. **Primary Auth user — last.**

Rules:

* **Idempotent.** Every step re-queries current state and deletes what exists.
* **Auth is last.** A timeout or failure leaves the account usable so the user
  can sign in and retry. Nothing after the Auth delete can throw before the
  response is returned.
* **Deadline.** `DELETION_TIME_BUDGET_MS` is 8 minutes; the function timeout is
  540 s. Very large accounts abort with `deadline-exceeded` and resume on retry.
* **No collateral topic deletion.** If the departing user's comment was the
  only comment on someone else's topic, the topic is kept and its
  `commentCount` repaired; only topics the user authored are deleted.
* **Personal-content failures are fatal.** A failed suggestions, freewrite,
  live-game, DM, reaction, storage or entitlement step aborts before the Auth
  record is deleted so a retry can finish. Only Stripe cancellation (billing is
  external) and an empty/missing storage bucket are non-fatal.
* **Indexes keep the queries bounded.** Message/art/report queries use
  `orderByChild`; the social rules carry the matching `.indexOn` entries. Any
  rejected or failed query aborts the sweep (safely, before Auth deletion)
  rather than silently skipping personal data. Deploy the social RTDB rules
  before the function.

## Data inventory

### Deleted

| Project | Data |
| :--- | :--- |
| Primary Firestore | `users/{uid}` and every subcollection (`settings`, `notes`, `tasks`, `journal`, `library`, `pro_data`, `privateSettings`, `reading_*`, `watchlist`, `chatLimits`, …), every `leaderboard_*` doc, `game_runs/{uid}_{game}`, `score_audit` rows, `interactive_uploads` / `sheet_music_uploads` owned by the user, `word_games` where `p1_uid`/`p2_uid` matches, `config/supporters[email]`, `config/moderators[uid]`, legacy Firestore `rooms/*/messages` written by the user (old KindleChat DMs, words.html notices) and the user's handle in each room's `participants` |
| Primary RTDB | `users_public/{uid}`, `user_cards/{uid}`, `users_private/{uid}`, `presence/{uid}`, `timeouts/{uid}`, `moderators/{uid}`, `mail_rate_limits/{uid}`, `kindlechat/user_limits/{handle}`, `suggestions` authored by the user plus their `upvotes/{uid}` and comments on other suggestions, `freewrite_sessions` with `ownerId == uid`, `matchmaking/*` listings hosted by the user, the user's `games/*/*/chat` lines, and their `players/{uid}` node in open lobbies |
| Primary Storage | `users/{uid}/files/**`, `users/{uid}/photos/**` (bucket-wide prefix) |
| Social Firestore | `topics` authored by the user (with comments + pollVotes), the user's comments on other topics, their `pollVotes/{uid}` on every other topic, `neighbourhood_posts` authored by the user (with comments), the user's comments on other posts |
| Social RTDB | `kindlechat/messages` (by `uid` and legacy `user` handle) + their `translations_by_lang/*` entries + `art_index` entries, the user's `reactions/{uid}` on other people's messages, all DM threads the user participates in (messages, thread node, every participant's inbox row), `dm_prefs/{uid}`, `dm_blocks` in either direction, `reports` where `reporterId` or `reportedUserId` is the user, `users_public/{uid}`, `user_cards/{uid}`, `users_private/{uid}`, `timeouts/{uid}`, `server_rate_limits/{uid}`, `user_recent/{uid}` |
| Auth | primary `rekindle-dd1fa` user and social `rekindle-socials` user |
| Stripe | active subscriptions cancelled and customer deleted **only if `STRIPE_KEY` is set** |

### Deliberately retained

| Data | Why |
| :--- | :--- |
| `banned_ips`, `users_private` ban linkage | Network-level safety. Deleting an account must not let a banned user evade a ban; moderators remove bans manually. |
| `mod_actions` (365 d), `automod_log` (30 d), `automod_strikes` | Moderation audit trail. Contains moderator/target uids, not the user's private content. (`automod_strikes` has rules but no writer in the repo; verify in the console before relying on it.) |
| In-progress `games/{game}/*` state (board, strokes, turn order) | Ephemeral live-match state. Deleting a player mid-match would corrupt the match for everyone else; turns/AFK timers handle a vanished player. Chat lines and lobby membership are still removed. |
| Stripe invoices / payment records | Financial record-keeping, held by Stripe. |
| Cloud Logging entries | Operational logs, provider retention (30 d default); no content is intentionally logged. |
| Orphaned `translations_by_lang` / `art_index` entries from messages already deleted by retention | Pre-existing orphan class documented in [social-cleanup.md](social-cleanup.md); a one-time sweep is still on the backlog. |

Also not deleted: `interactive_blacklist`, `config/supporters` for other users,
`banned_ips`, and anything under another uid.

## UI notes (settings.html)

* The danger row is rendered only when signed in (`#delete-account-row`).
* The modal is a **direct child of `<body>`** and uses `z-index: 10002`, above
  the generic modal (10001). The page has no transformed/z-indexed ancestor
  wrapper around it, so the overlay covers the whole window.
* The confirmation name is the email handle, displayed read-only; the input is
  compared client-side for instant feedback and re-checked server-side.
* While deleting, both buttons are disabled (`deleteAccountBusy`) and the modal
  cannot be dismissed. On success the form is replaced by a confirmation
  message, `localStorage.clear()` runs (removes cached profile/settings), the
  Firebase session is signed out, and the page returns to `index` after 3 s.
  A `deleteAccountDone` flag prevents the auth-state listener from closing the
  success modal.
* No `alert()`/`confirm()`; errors render inline inside the modal.
* `firebase-functions-compat.js` is loaded in `<head>` (the page previously
  only loaded app/firestore/auth).
* The Help FAQ article (`help-data.js`, "How do I delete my account or data?")
  describes the button, so it must change with the flow. On 2026-10-24 it still
  said "there is no self-service delete button yet" after the feature shipped;
  the article was rewritten and `help-data.js?v=` bumped to 5 in `help.html`.
  Bump that query string whenever the article changes (shared-asset cache rule).

## Stripe

`STRIPE_KEY` is optional in `firebase-functions/.env`. When present the function
lists the customer's subscriptions, deletes every non-cancelled one, then
deletes the customer (best effort, 8 s timeout each). When absent, it logs a
warning and continues; the modal warns users to cancel a recurring plan on
`pay` first. Set the secret and redeploy to enable automatic cancellation.

## Deploy

```bash
# 1. RTDB indexes first — the social queries need them. Deploying functions
#    before this makes deletion fail safely (Auth stays), so order matters.
npm run deploy:rules:social:rtdb

# 2. The callable.
firebase deploy --only functions:deleteAccount --project rekindle-dd1fa

# 3. Optional: enable Stripe auto-cancel.
#    Add STRIPE_KEY=... to firebase-functions/.env, then redeploy the function.

# 4. Deploy the site (settings.html changed; no shared JS/CSS URL bump needed).
npm run deploy:prod   # or deploy:beta
```

No Firestore rules deploy is required: the Admin SDK bypasses rules and the
client only reads its own `users/{uid}` (already allowed).

## Verification

Automated:

```bash
node scripts/test-account-deletion.js
```

Covers the confirmation rules (including the empty-username trap), the 10-minute
window, uid/path safety, the primary/social RTDB path inventory, report
ownership, and the handler preconditions (unauthenticated, no social project,
stale login, wrong/blank confirmation).

**Test-run dependency (2026-10-24):** both CI workflows install only the root
dependencies (`npm ci` at the repo root), so `firebase-functions` is absent from
node_modules there — it only exists in `firebase-functions/node_modules` after
`npm ci` inside that folder. `account-deletion.js` imports
`firebase-functions/logger` and `firebase-functions/v2/https` at load time, so
`npm test` failed in GitHub Actions with `Cannot find module
'firebase-functions/logger'` while passing locally. The test now resolves those
ids from `firebase-functions/` first; when the package is missing it injects
minimal `logger` / `HttpsError` stand-ins via `Module._load` before requiring the
handler. When the package is installed the real runtime is used, so a renamed
import path still fails the test instead of being masked. Do not "fix" a future
MODULE_NOT_FOUND here by adding a functions `npm ci` to the site deploy
workflow — the shim is deliberate.

Manual with a throwaway account:

1. Register `deletetest`, then create: a KindleChat message, a topic + comment
   on another topic, a Neighbourhood post + comment, a leaderboard score, a
   note.
2. Settings → Delete Account. Confirm the username label and that a wrong
   password/username shows an inline error.
3. Delete. Expect the success screen and redirect; signing in again fails with
   the account not found.
4. Console checks: Auth users gone in both projects; `users/{uid}` gone;
   `users_public/{uid}`, `user_cards/{uid}`, `users_private/{uid}` gone in both
   RTDBs; chat message gone; topic/comment and post/comment gone; leaderboard
   doc gone; `users/{uid}` Storage prefix empty.
5. Check `users_public` entries for other users are untouched and that a topic
   the user commented on (but did not author) still exists with a repaired
   `commentCount`.

## Limitations / edge cases

* **Large accounts** may hit the 8-minute budget. Retrying resumes; if it keeps
  timing out, reduce scope by deleting content in batches or raise the budget
  while staying below the 540 s deployment timeout.
* **Free-tier Firestore quota:** deleting many comments can return
  `RESOURCE_EXHAUSTED`. The function reports `internal`, Auth stays, and a retry
  after the midnight-Pacific reset finishes the job.
* **Comment sweeps use collection-group queries.** `collectionGroup('comments')
  .where('authorId'|'uid','==',uid)` is served by Firestore's automatic
  single-field collection-group indexes — do **not** declare a composite
  index for these; the API rejects it with "this index is not necessary,
  configure using single field index controls". If the query is ever rejected
  for a missing index, the function logs a warning and falls back to one
  `comments` query per topic/post. That fallback is fine at current scale but
  can time out on a very large social dataset; a timeout aborts before Auth is
  deleted and resumes on retry. Topic poll votes still require the topic list
  scan because `pollVotes` has no per-user index.
* **Storage / entitlement failures are fatal before Auth.** A wrong bucket, a
  permission error, or a failed `config/supporters` / `config/moderators` write
  aborts the sweep while the account still exists; retry after fixing the
  configuration. A 404 bucket is treated as empty.
* **Chat reactions** require a full scan of the retained `kindlechat/messages` node because RTDB cannot query a nested `reactions/{uid}` key. On a very large chat window this is the most expensive single step; it runs after the user's own messages are deleted and before Auth is removed, so a timeout is retryable.
* **Translation languages** are the hard-coded `TRANSLATION_LANGS` list. A
  language added to the translate worker without updating `cleanup-lib.js`
  leaves orphaned translation entries.
* **Primary legacy KindleChat** (`rekindle-dd1fa`'s `kindlechat/messages`) is
  not swept: chat has lived in the social project since the split, and the
  existing `admin/nuke_user.js` also only scans social. If legacy data is found,
  add `uid`/`user` indexes to the primary rules and reuse
  `buildChatDeletePaths`.
* **Profanity filter / moderation worker** state for the deleted user is not
  carried anywhere else; a re-registration starts clean (new uid).
* **Search indexes** (none in this app) and Firebase console caches can lag
  behind deletions; that is eventual consistency, not retained data.
