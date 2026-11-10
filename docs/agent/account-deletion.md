# Permanent Account Deletion (`deleteAccount`)

Added 2026-10-24. **Policy changed 2026-11-10:** account deletion removes the
account's private/main-project data only. Social history is retained and ages
out through `cleanupSocial` exactly as it does for an active account.

Read before changing `settings.html`'s Account section,
`firebase-functions/account-deletion.js`, `account-deletion-lib.js`, or
`firebase-functions/social-cleanup.js`.

## What it is

A **Delete Account** button in the Settings Account section. The user
reauthenticates with their password and types their username; a Cloud Function
(`deleteAccount`, v2 callable in the **primary** project) then removes the
account, its private data, its primary profile/leaderboard copies and Firebase
Storage files, and finally the primary Auth record.

This is an **immediate, permanent** deletion. There is no grace period and no
"restore account" path; the Auth record is deleted, so the username becomes
available for registration again.

**Social history is deliberately not touched**, but the account's social
**profile records** are removed so social apps can show a neutral deleted-user
identity. The deleted profile records are `users_public/{uid}`,
`user_cards/{uid}` and `users_private/{uid}` in the social RTDB. A social page
that looks one up gets `null`, draws a blank white avatar and displays
"Deleted User".

Topics, comments, neighbourhood posts, KindleChat messages, DMs, reports and
art index entries are history. They are retained and treated exactly like an
active account's history:

| Social data | Retention |
| :--- | :--- |
| KindleChat messages, translations, art index | 30 days, plus the latest 50 messages |
| Topic comments / empty topics / neighbourhood posts | 90 days |
| Resolved or dismissed reports | 90 days |
| Pending reports, DMs, `users_public`, `user_cards`, `users_private`, timeouts | Never deleted by cleanup |

The daily `cleanupSocial` job owns that retention; see
[social-cleanup.md](social-cleanup.md). There is **no tombstone and no special
deleted-account path for history** — the cleanup does not know, and must not
need to know, whether the author's account still exists. The only deleted-account
special case is the profile-node removal above.

Why server-side: clients cannot delete Storage files or an Auth record (rules
deny those writes), and a browser-side sweep dies when the tab closes.

## Files

| File | Role |
| :--- | :--- |
| `settings.html` | Danger row, confirmation modal, reauthentication, callable invocation, success screen |
| `firebase-functions/account-deletion.js` | Primary Firestore + RTDB + Storage + Auth deletion |
| `firebase-functions/account-deletion-lib.js` | Pure rules: confirmation, recent-login window, primary RTDB path builders, summary |
| `firebase-functions/index.js` | Exports `deleteAccount` with `timeoutSeconds: 540`, `memory: "512MiB"` |
| `scripts/test-account-deletion.js` | Pure helpers + handler precondition tests (runs in `npm test`) |
| `firebase-functions/social-cleanup.js` | Age-based social retention; **not** invoked by account deletion |

## Callable contract

`POST` via `firebase-functions` callable, primary app.

* **Auth:** required (`request.auth.uid`).
* **Data:** `{ confirmation: string }` — the user's username. The browser never
  sends a uid, path or document list.
* **Preconditions:**
  1. `SOCIAL_SERVICE_ACCOUNT_JSON` must be configured: deleting the social
     profile uses the social RTDB. This is three node deletes, not a Firestore
     sweep, so it does not consume the social Firestore quota.
  2. `auth_time` must be within **10 minutes** (`RECENT_AUTH_MAX_SECONDS`). The
     client calls `reauthenticateWithCredential()` then `getIdToken(true)` so
     the token carries the fresh claim.
  3. `confirmation` must equal the account's email handle
     (`alice@rekindle.ink` → `alice`), compared case-insensitively with
     surrounding whitespace ignored. If the handle is empty it falls back to
     the primary `users_public/{uid}/username`. An empty expected username
     always fails (never turn the check into a no-op).
* **Returns:** `{ deleted: true, counts: {...} }`.
* **Error details:** `failed-precondition` + `details.code ===
  'recent-login-required'` when the login is stale; `permission-denied` for a
  wrong confirmation; `deadline-exceeded` if the 8-minute budget is exhausted;
  `internal` for an incomplete sweep. The client maps these to friendly text.

The function does **not** query social Firestore, so a social Firestore quota
exhaustion or the missing collection-group indexes cannot block deletion. It
only writes three social RTDB profile paths.

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
3. Primary Firestore (user tree, leaderboards, game runs, audits, uploads,
   legacy rooms, entitlements).
4. Primary RTDB (profiles, presence, timeouts, suggestions, freewrite,
   matchmaking, live-game membership).
5. Social profile records (`users_public/{uid}`, `user_cards/{uid}`,
   `users_private/{uid}`) so social apps resolve to Deleted User.
6. Firebase Storage `users/{uid}/**`.
7. **Primary Auth user — last.**

Rules:

* **Idempotent.** Every step re-queries current state and deletes what exists.
* **Auth is last.** A timeout or failure leaves the account usable so the user
  can sign in and retry. Nothing after the Auth delete can throw before the
  response is returned.
* **Deadline.** `DELETION_TIME_BUDGET_MS` is 8 minutes; the function timeout is
  540 s. Very large accounts abort with `deadline-exceeded` and resume on retry.
* **No social history sweep.** The handler no longer calls
  `cleanupSocialFirestore()` or `cleanupSocialRtdb()` and no longer deletes the
  social Auth user. Those functions remain in `account-deletion.js` only as
  deprecated reference code; do not call them again. It *does* call
  `cleanupSocialProfile()` for the three profile nodes.
* **No social quota / index dependency.** The 2026-11-08 timeout was caused by
  the removed social sweep. `comments.authorId` / `comments.uid`
  collection-group indexes are still useful for other admin tooling, but
  account deletion no longer needs them. `admin/ensure_comment_indexes.js` is
  retained for the archive/admin scripts.

## Data inventory

### Deleted (primary project)

| Project | Data |
| :--- | :--- |
| Primary Firestore | `users/{uid}` and every subcollection (`settings`, `notes`, `tasks`, `journal`, `library`, `pro_data`, `privateSettings`, `reading_*`, `watchlist`, `chatLimits`, …), every `leaderboard_*` doc, `game_runs/{uid}_{game}`, `score_audit` rows, `interactive_uploads` / `sheet_music_uploads` owned by the user, `word_games` where `p1_uid`/`p2_uid` matches, `config/supporters[email]`, `config/moderators[uid]`, legacy Firestore `rooms/*/messages` written by the user and the user's handle in each room's `participants` |
| Primary RTDB | `users_public/{uid}`, `user_cards/{uid}`, `users_private/{uid}`, `presence/{uid}`, `timeouts/{uid}`, `moderators/{uid}`, `mail_rate_limits/{uid}`, `password_reset_limits/{uid}`, `security_events/{uid}`, `kindlechat/user_limits/{handle}`, `suggestions` authored by the user plus their `upvotes/{uid}` and comments on other suggestions, `freewrite_sessions` with `ownerId == uid`, `matchmaking/*` listings hosted by the user, the user's `games/*/*/chat` lines, and their `players/{uid}` node in open lobbies |
| Primary Storage | `users/{uid}/files/**`, `users/{uid}/photos/**` (bucket-wide prefix) |
| Social RTDB profile | `users_public/{uid}`, `user_cards/{uid}`, `users_private/{uid}` — username, avatar seed/custom avatar, social private profile |
| Auth | primary `rekindle-dd1fa` user |
| Stripe | active subscriptions cancelled and customer deleted **only if `STRIPE_KEY` is set** |

Note: the primary `users_public`/`user_cards` copies and the `suggestions`
board live in the **main** project, so they are part of the account deletion.
The **social-project** copies and all social history stay.

### Deliberately retained

| Data | Why |
| :--- | :--- |
| **All social Firestore history** — topics, comments, poll votes, neighbourhood posts/comments | Age-based retention in [social-cleanup.md](social-cleanup.md); treated exactly like an active account |
| **All social RTDB history** — KindleChat messages/translations/art index, reactions, DM threads/messages, reports | Same age-based retention (DMs are never cleaned) |
| Social `timeouts`, rate limits, `dm_prefs`, `dm_blocks` | Social account state; not history, but not needed for the Deleted User rendering. Left untouched to keep the deletion write set tiny. |
| Social Auth user (`rekindle-socials`) | No social login path survives without the primary Auth record; leave it as history |
| `banned_ips`, primary `users_private` ban linkage | Network-level safety. Deleting an account must not let a banned user evade a ban; moderators remove bans manually. |
| `mod_actions` (365 d), `automod_log` (30 d), `automod_strikes` | Moderation audit trail. |
| In-progress `games/{game}/*` board/strokes/turn order | Ephemeral match state; deleting a player mid-match would corrupt the match for everyone else. Chat lines and lobby membership are still removed. |
| Stripe invoices / payment records | Financial record-keeping, held by Stripe. |
| Cloud Logging entries | Operational logs, provider retention; no content is intentionally logged. |
| Orphaned `translations_by_lang` / `art_index` entries | Pre-existing orphan class; one-time sweep on the backlog. |

## Social rendering after deletion

`kindlechat.html`, `topics.html` and `neighbourhood.html` load
`js/deleted-user.js?v=1`. When a `rekindleFetchUserCard()` lookup returns no
card (or a `{deleted:true}` tombstone), they must:

* fill the avatar canvas white and draw nothing (`drawAvatar(canvas, null)`);
* display `window.rekindleDeletedUserName()` (English fallback "Deleted User")
  instead of a uid prefix, a message snapshot, or a procedural avatar.

Do not fall back to the uid for a missing card: that is the deleted-profile
case. The helper lives in a separate file so changing it does not require a
`theme.js` cache-version bump across every page.

A client that already has a cached card can keep showing the old name/avatar
until the card cache expires (15 min memory / 1 h localStorage); a fresh lookup
gets `null`.

## UI notes (settings.html)

* The danger row is rendered only when signed in (`#delete-account-row`).
* The modal is a **direct child of `<body>`** and uses `z-index: 10002`, above
  the generic modal (10001).
* The confirmation name is the email handle, displayed read-only; the input is
  compared client-side for instant feedback and re-checked server-side.
* While deleting, both buttons are disabled (`deleteAccountBusy`) and the modal
  cannot be dismissed. On success the form is replaced by a confirmation
  message, `localStorage.clear()` runs, the Firebase session is signed out, and
  the page returns to `index` after 3 s. A `deleteAccountDone` flag prevents the
  auth-state listener from closing the success modal.
* No `alert()`/`confirm()`; errors render inline inside the modal.
* `firebase-functions-compat.js` is loaded in `<head>`.
* The Help FAQ article (`help-data.js`, "How do I delete my account or data?")
  describes the button. Bump `help-data.js?v=` whenever the article changes.

## Stripe

`STRIPE_KEY` is optional in `firebase-functions/.env`. When present the function
lists the customer's subscriptions, deletes every non-cancelled one, then
deletes the customer (best effort, 8 s timeout each). When absent, it logs a
warning and continues.

## Deploy

```bash
# The callable only (no social rules, no social indexes needed).
firebase deploy --only functions:deleteAccount --project rekindle-dd1fa

# Optional: enable Stripe auto-cancel.
# Add STRIPE_KEY=... to firebase-functions/.env, then redeploy the function.

# Deploy the site only if settings.html/help copy changed.
npm run deploy:prod
```

## Verification

Automated:

```bash
node scripts/test-account-deletion.js
```

Covers the confirmation rules (including the empty-username trap), the 10-minute
window, uid/path safety, the primary RTDB path inventory, report ownership and
the handler preconditions (unauthenticated, stale login, wrong/blank
confirmation). The obsolete "rejects when the social project is not configured"
case was removed with the policy change.

Manual with a throwaway account:

1. Register `deletetest`, then create: a KindleChat message, a topic + comment
   on another topic, a Neighbourhood post + comment, a leaderboard score, a
   note, and a Storage file.
2. Settings → Delete Account. Confirm the username label and that a wrong
   password/username shows an inline error.
3. Delete. Expect the success screen and redirect; signing in again fails with
   the account not found.
4. Console checks:
   * Primary Auth user gone; `users/{uid}` gone; Storage prefix empty.
   * Primary `users_public/{uid}`, `user_cards/{uid}` gone.
   * The social `users_public/{uid}`, `user_cards/{uid}` and
     `users_private/{uid}` are **gone**; a social page shows a blank avatar and
     "Deleted User" for that uid.
   * The chat message, topic/comment and post/comment **still exist**.
5. Re-register the same username; it should succeed (Auth email is free).
6. Wait for/trigger `cleanupSocial`; old social content should age out on the
   normal schedule, not because the account was deleted.

## Limitations / edge cases

* **Large primary accounts** may hit the 8-minute budget. Retrying resumes; if
  they keep timing out, reduce scope by deleting content in batches or raise
  the budget while staying below the 540 s deployment timeout.
* **Social history remains after deletion; only the profile is removed.**
  Public history (chat/topics/posts) ages out. DMs, `timeouts` and pending
  reports are never deleted by `cleanupSocial`, so they persist exactly as they
  would for an active account. Clients with a cached user card can keep showing
  the old name/avatar until the card cache expires (15 min in memory / 1 h in
  localStorage); a fresh lookup gets `null` and renders Deleted User.
* **Storage / entitlement failures are fatal before Auth.** A wrong bucket, a
  permission error, or a failed `config/supporters` / `config/moderators` write
  aborts the sweep while the account still exists; retry after fixing the
  configuration. A 404 bucket is treated as empty.
* **Primary legacy KindleChat** (`rekindle-dd1fa`'s `kindlechat/messages`) is
  still not swept: chat has lived in the social project since the split. If
  legacy data is found, add `uid`/`user` indexes to the primary rules and reuse
  `buildChatDeletePaths`.
* **Profanity filter / moderation worker** state is not carried anywhere else;
  a re-registration starts clean (new uid).
* **Search indexes** (none in this app) and Firebase console caches can lag
  behind deletions; that is eventual consistency, not retained data.
