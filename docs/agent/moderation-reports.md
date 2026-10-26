# Reports & Moderation

Report UI -> `rekindle-moderate` worker -> RTDB `/reports`. Read before touching `js/reports.js`, any report button, `moderation.html`, or the worker's `report` handler.

## 📋 Reporting System

Users can report content across all social apps. Reports are stored in RTDB and read by the moderation console.

### Architecture
- **Client Module:** `js/reports.js` — provides `rekindleOpenReportModal()` with System 7 styling
- **Backend Handler:** `workers/rekindle-moderate/worker.js` handles `type: "report"` requests
- **Storage:** RTDB `/reports` on the **social** project (`rekindle-socials`)
- **Notifications:** **none since 2026-10-25.** The Discord bot notification (embed + Delete/Timeout/Dismiss buttons) was removed at the owner's request, and the `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` / `DISCORD_WEBHOOK_URL` secrets were deleted from the old Worker. Reports are visible in `/reports` and the moderation console only. The `/discord-interaction` handler remains in the code for the old deployment, but with no notification messages there are no buttons to click.

### Data Model (`/reports` RTDB)
Each entry is keyed by a Firebase push ID and contains:
```javascript
{
  reporterId, reporterName,
  reportedUserId, reportedUserName,
  contentType, contentId, contentPath,
  reason, comment, contentSnapshot,
  dmContext?,                       // KindleChat DM reports only: last 10 messages
  status: "pending" | "resolved" | "dismissed",
  createdAt, resolvedAt, resolvedBy, resolutionNote
}
```

### KindleChat direct-message reports (`dm_message`)
DM reports are special because message IDs are only unique inside a thread:
- The client sends `contentType: 'dm_message'`, `contentId: '<messageId>'` and `contentPath: 'kindlechat/dm_messages/<threadId>/<messageId>'`.
- The worker **ignores** the client's author/snapshot/path: it verifies the reporter is a thread participant, reads the message from the social RTDB, derives the path/author/snapshot, and attaches `dmContext` (last 10 messages). A forged path cannot auto-delete another thread.
- `dm_message` is in `IMMEDIATE_DELETE_TYPES` (first report deletes) and `autoDeleteContent` only accepts the strict DM path shape.
- Moderators deliberately have **no blanket read rule** on `dm_threads`/`dm_messages`; the report's `dmContext` is the only context they see. Discord's delete action looks up the report to recover the thread path.
- Cleanup of a deleted user's DM data is done by `admin/cleanup_user.js` / `admin/nuke_user.js` (service account), not the moderation console.

### RTDB Rules
Reports live under `/reports` in `rtdb-social-rules.json`:
- `.read`: `ukiyo@rekindle.ink` **only since 2026-10-26** (was also `auth.token.moderator === true`). Reports carry private DM excerpts, and the console is owner-only, so no volunteer claim should be able to list them.
- `.write`: `ukiyo@rekindle.ink` or the social service account
- `.indexOn`: `["contentId", "contentType", "status", "createdAt", "reporterId", "reportedUserId"]`

### Report comments are required (2026-10-26)
Every report must include a comment with **at least one real word** — 2+ letters in any script. `""`, `"!!!"`, `"12345"`, `":)"` and emoji-only comments are rejected.
- Server gate: `reportCommentError()` in `workers/rekindle-moderate/worker.js`, called in the `report` handler **before** the rate limiter, so a bad request costs no token.
- Client mirror: `js/reports.js` (`reportCommentError()` / `hasProperWord()`, exported as `window.rekindleReportCommentError` / `window.rekindleReportCommentIsValid`); the modal marks the field `Comment *`.
- Keep the two in sync — `scripts/test-reports.js` (in `npm test`) loads both and asserts they agree on a sample table plus the 500-char ceiling.
- Budget: the modal caps input at 200 chars (`maxLength`), the worker accepts up to 500.

### Rate Limits
- 60 reports per hour per user (enforced in moderation worker)

### Adding Report Buttons to New Social Apps
1. Include `<script src="js/reports.js"></script>` in the HTML `<head>`
2. Call `rekindleOpenReportModal({contentType, contentId, contentPath, reportedUserId, contentSnapshot})`

### Files Modified
- `js/reports.js` (new)
- `workers/rekindle-moderate/worker.js` — added report handler + Discord notification
- `kindlechat.html` — report buttons on general messages and DM messages
- `neighbourhood.html` — report buttons on posts and comments
- `topics.html` — report buttons on topics and comments
- `moderation.html` — added "User Reports" panel with pending/resolved/dismissed filters
- `firestore-social.rules` — added `reports` collection rules

### Discord Bot Setup (removed 2026-10-25 — historical only)

The notification code (`sendDiscordReportNotification`) and the bot secrets were
removed at the owner's request. Do not re-add them unless explicitly asked. Notes kept
for a future re-enable:

Set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` on the **ReKindle Social**
`rekindle-moderate` Worker. Never commit the bot token — use Worker secrets.

1. Create/choose a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. "Bot" tab → Reset Token → copy it
3. Invite the bot with "Send Messages" and "Embed Links"
4. `npx wrangler secret put DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` from
   `workers/rekindle-moderate` with the social account's `CLOUDFLARE_ACCOUNT_ID`/token

**Auto-Deletion:** When 2 different users report the same content (same `contentType` + `contentId`), the content is automatically deleted and both reports are marked as "resolved" — independent of Discord. The notification, when enabled, showed a green embed.

**Discord Action Buttons (historical):** the notification had 3 buttons:
- **Delete Content** — manually deletes the reported content
- **Timeout User (24h)** — applies a 24-hour timeout
- **Dismiss Report** — marks the report resolved without action

The buttons are handled by `POST /discord-interaction` (`DISCORD_PUBLIC_KEY`). The old
Worker still has the public key and the endpoint; the ReKindle Social Worker does not,
and it is unused while notifications are off. If re-enabling, set the Discord app's
Interactions Endpoint URL to the **current** Worker:
`https://rekindle-moderate.rekindle-social.workers.dev/discord-interaction`.

### RTDB Indexes Required
Reports live under `/reports` in the social RTDB. The dashboard reads from RTDB and filters/sorts in memory, but the worker query for existing reports uses `orderByChild('contentId').equalTo(...)`, so an index on `contentId` is required for performance at scale.

1. **Reports node:**
    - **Path:** `/reports`
    - **Index fields:** `contentId`

### Auto-Delete Behaviour
When 2 different users report the same content (same `contentType` + `contentId`), the worker attempts to automatically delete the content. If deletion succeeds, both reports are marked as `resolved`. If deletion fails (e.g. RTDB permission issue), both reports remain `pending` so moderators can review them manually. (The Discord notification, when it existed, showed whether the auto-delete succeeded.)

### Security: Escaping for JS String Literals
When passing user-generated text into `onclick` HTML attributes, **never rely solely on `escapeHtml()`**. HTML entity decoding happens before JS execution, so `&#039;` becomes `'` and breaks out of the string literal.

**Correct pattern** (used in all report buttons):
```javascript
var safeText = userText
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u0026/g, '\u0026amp;')
    .replace(/\u003c/g, '\u0026lt;')
    .replace(/\u003e/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;');
```

### Guarding Optional Firebase / CDN Dependencies
If an app can function without Firebase (e.g., local-only games), wrap Firebase initialization and all `auth`/`db` usage in feature checks. A blocked or failed CDN script must not prevent the rest of the page script from running. Use `typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && typeof firebase.firestore === 'function'` before initializing, and guard every `db.collection(...)` / `auth.onAuthStateChanged(...)` call. See `nonograms.html` for the pattern used in this codebase.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).

## Report Retention (2026-10-21)

`cleanupSocial` prunes moderation records daily: resolved/dismissed reports older than **90 days**,
`automod_log` entries older than **30 days**, and `mod_actions` entries older than **365 days**.
Pending reports are never auto-deleted — they remain the moderator queue, and if the oldest report
page is entirely pending the cleanup task stops rather than re-reading it every day. Old `mod_actions`
entries can no longer be undone from `moderation.html`. Full design:
[social-cleanup.md](social-cleanup.md).

## 2026-10-21 backlog pass

- **Timeout lookups are cached per uid for 30 s** (`timeoutCache` in
  `workers/rekindle-moderate/worker.js`). Every content write used to pay an RTDB GET for
  `timeouts/{uid}`, a node that is empty for almost every user. Repeat attempts from a timed-out
  user now stop costing a Firebase round trip. A newly set timeout takes effect within 30 s.
- **Report buttons are 48×48 touch targets**: the 20 px circle is now a `.report-dot` inside a
  transparent `.report-btn` that occupies real layout space (no overlap with the timestamp /
  Edit button). Applied in `neighbourhood.html` and `topics.html`.
- **Discord "Delete" now resolves comment paths from the stored report.** `getContentPath()` used
  to return `topics/{commentId}` / `neighbourhood_posts/{commentId}` for `topic_comment` /
  `neighbourhood_comment`, i.e. it treated a comment id as a parent id — the delete hit a
  non-existent document and did nothing. Those types (and `suggestion_comment`, `dm_message`) now
  return `""` from `getContentPath()` and `handleDiscordInteraction()` falls back to the
  `contentPath` stored on the pending report. `autoDeleteContent()` also validates the path shape
  (`parseCommentPath()`) and that the trailing id matches `contentId` before deleting, and adjusts
  the parent's `commentCount` afterwards (see `performance.md`).

## Moderation console rebuild (2026-10-26)

Social moderation is automated end to end, so `moderation.html` was rebuilt as **one owner-only
System 7 window with tabs** instead of five stacked panels.

| Tab | Reads/writes |
| :--- | :--- |
| Automod Log | `automod_log` (social RTDB), `orderByKey().limitToLast(N)` |
| Reports | `reports` (social), bounded queries; resolve/dismiss writes |
| Banned IPs | `banned_ips` (primary), remove |
| Users | `users_public` / `user_cards` / `users_private` / `users` doc; auth-status callables; Pro + IP + cleanup writes |
| Content Review | `kindlechat/messages`, social Firestore `topics` / `neighbourhood_posts` |

Removed in the rebuild: Grant/Revoke Moderator, the "Moderator Actions" log with undo/restore
(it wrote to Firestore collections whose rules are `allow create: if false`, so a restore could
never succeed), the timeout section (`timeouts` writes), owner-vs-moderator IP redaction, and the
legacy Firestore `rooms` DM scan (no rules for `rooms` exist any more, so it could only fail).

`?tab=automod|reports|ips|users|content` deep-links a tab. Each tab loads lazily on first visit and
has its own Refresh, so opening the console no longer fires five reads at once.

### The automod log lives in the SOCIAL RTDB

`logAutomodRejection()` pushes to `automod_log` on **rekindle-socials**, and `cleanupSocial` prunes
it after 30 days. Two permission problems were fixed in the same pass:

* `rtdb-social-rules.json` had **no `automod_log` node at all** — default-deny meant no client
  could ever read the log. Added `.read` for the owner, service-account `.write` (the Worker uses
  its access token), and `.indexOn: ["timestamp", "uid", "contentType"]`.
* `rtdb-rules.json` carried `automod_log`, `automod_strikes` and `automod_last_action` blocks for
  the **primary** database that nothing has written (verified: the node is `null` in both
  projects). Removed so nobody wires a console to the wrong project again.

At audit time `/automod_log` was **empty**, even though the write path works (a create/read/delete
probe with the social service account succeeded, and `kindlechat/server_rate_limits` — same
database, same token — is full of live writes). That points at a stale `rekindle-moderate`
deployment rather than a permissions bug: redeploy the Worker and confirm a rejected message shows
up before assuming the panel is broken.

### Reports are queried in bounded slices

`/reports` held **17,406 entries (16,150 pending)** on 2026-10-26. The old `fetchReports()` read the
whole node on every open — several megabytes per page load. It now asks for
`orderByChild('status').equalTo(<filter>)` + `limitToLast(N)` (or `orderByChild('createdAt')` for
"All"), with N from the "Show newest" select. Both fields are in `.indexOn`. The table shows
"Showing newest N", never a fake total.

### Other permissions fixes from the same audit

* `moderation.html` gates on `user.email === 'ukiyo@rekindle.ink'` only. The moderator branch is
  gone, and a non-owner who opens the page is signed out of the social project.
* `getUserAuthStatus` / `getSocialUserAuthStatus` were callable by any moderator (they reveal
  whether a targeted account is disabled). Now owner-only, matching their only caller.
* `banned_ips` was `.read: true` at the node root, so anyone could dump every banned IP with its
  usernames and reasons. The root is owner-only now; `$ip` stays publicly readable because
  `js/ip-ban.js` reads exactly `banned_ips/{formattedIp}`.
* `reports` `.read` no longer accepts `auth.token.moderator === true` (reports include private DM
  excerpts and the console is owner-only).

