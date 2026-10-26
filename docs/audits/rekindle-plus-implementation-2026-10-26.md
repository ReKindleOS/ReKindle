# ReKindle+ audit — implementation status (26 October 2026)

This is the companion to [the audit](rekindle-plus-2026-10-26.md). It records what was changed in response, what is verified, what still needs deployment, and what was deliberately left for a larger project.

**Status:** code complete for the P0 code fixes (a strict CSP remains a follow-up) and most P1 items; `npm test` and `npm run build` pass. **Nothing has been deployed to production.**

---

## 1. Shipped

### Security and trust

| Change | Where | What it does |
|---|---|---|
| Firebase-authenticated AI worker | `workers/rekindle-oracle/worker.js` | Rejects anonymous requests, verifies the ID token with Identity Toolkit, checks the Firestore Pro expiry, and keeps a server-side daily quota in `chatLimits`. Accepts a `messages` array for multi-turn chat. |
| Firebase-authenticated OCR worker | `workers/rekindle-ocr/worker.js` | Rejects anonymous requests and checks the Pro entitlement before running the Workers AI model. |
| Client tokens to both workers | `chat.html`, `quicktodo.html`, `quicknotes.html` | Sends `Authorization: Bearer <Firebase ID token>` on AI/OCR requests. |
| AI key no longer stored in Firestore | `chat.html` | `saveSettings()` no longer writes `apiKey`; existing cloud keys are migrated to the device and deleted. Copy now says the key is device-only. The client quota mirror no longer double-counts the worker's counter. |
| Mail HTML sandboxing | `mail.html`, `js/safe-html.js` | Email HTML is parsed and sanitised (no scripts, event handlers, forms or dangerous URLs) before being appended; remote images are blocked behind a "Load images" button; error strings are escaped; the malformed `< div` markup is fixed. |
| Substack sanitisation | `substack.html` | Reader titles/body go through `safe-html`; remote images are blocked with an opt-in button. |
| Mastodon sanitisation + warnings | `mastodon.html` | Status HTML, display names, handles and avatars are escaped/sanitised; `sensitive`/`spoiler_text` posts hide their body and media behind a "Show content" control; external links open in the Browser app. |
| Bluesky sensitive media | `bluesky.html` | Posts labelled `porn`, `sexual`, `nudity`, `graphic-media` or `gore` hide their images; alt text is escaped; outbound links open in the Browser app. |
| Bluesky full i18n | `bluesky.html`, `locales/*.json` | All shell, login, feed, profile, search, notifications, chat, compose and message-modal strings now use `data-i18n`/`bskyText()` with English fallbacks. 67 `bluesky.*` keys in all 10 locales; dynamic counts/interpolation via `tFormat`; non-English time uses 24-hour format. |
| AirType session rules | `rtdb-rules.json` | `freewrite_sessions/{id}` is now readable/writable only by the `ownerId` account instead of every signed-in user. |
| Pro gate is idempotent | `pro-gate.js` | One Firebase auth listener and one promise per page; callbacks run once, removing duplicate Firestore reads and the double-callback behaviour. |
| New Mail attachment path | `firebase-functions/index.js`, `mail.html` | Body fetch returns attachment metadata; `fetchEmailAttachment` downloads one attachment on demand (6 MB cap) and the reader shows download buttons. |

### Funnel, localisation and Pro presentation

| Change | Where | What it does |
|---|---|---|
| i18n warm-cache fix | `js/i18n.js` | Re-applies translations on `DOMContentLoaded` and when the observer starts, so cached locales no longer leave Docs/Mindmap/etc. in English. Verified cold vs warm locally. |
| Timezone prompt no longer blocks modals | `time.js` | z-index lowered below `.modal-overlay` (10000), a "Later" button suppresses it for the session, and the "Sign in instead" path is unchanged. |
| Shared paywall rewrite | `pro-gate.js`, `index.html` | App-specific headline, three benefits, price line, guest/member CTA, "See what's included" link to `help.html#pro`, 48px actions. Removed the stale "I'm introducing a supporter tier" copy. |
| "Why is this paid?" | `index.html` | The dashboard upsell has a second link that opens the ad-free/independent explanation and a "Back to ReKindle+" button, translated in all 10 locales. |
| Pro badges/descriptions | `index.html`, `icons.js` | `+` circle replaced by a `PLUS` pill; Mail, Dropbox, AI Assistant, Files and Docs got benefit-led descriptions. |
| Dashboard upsell | `index.html` | One `showProUpsell()` helper for featured and normal tiles, with price/benefits and a guest-specific "Log in to subscribe" CTA. |

### App fixes

| App | Shipped |
|---|---|
| **Flipbook** | Fixed `max-min-height` → `min-height: 90vh` (gallery no longer 318px), controls wrap, 48px tool buttons, the Kindle zoom exemption, and visible save failures for local/cloud writes. |
| **Docs** | CKEditor/Mammoth/docx/FileSaver are lazy-loaded (no ~2.3 MB download on the startup screen); editor focuses after Create; "Start writing…" placeholder; filename shown in the title bar; "Saved to Files"/"Downloaded" toast; 1.5 s local draft autosave + "Restore unsaved draft"; recent `.docx` list on the startup screen; legacy `.doc` is rejected with a clear message. |
| **Files** | Accepts images, PDF, text, EPUB, ZIP and Word files; multi-file upload with progress, quota checks and duplicate-name suffixes; image preview plus PDF/text previews; escaped filenames; `ui-kit` empty state; updated Help. |
| **AI Assistant** | Per-user conversation history in localStorage, multi-turn `messages` sent to the worker, empty state with example prompts, "ReKindle AI" label, sanitised markdown, device-only key copy, worker quota. |
| **Quick ToDo / Quick Notes** | OCR errors are visible ("Couldn't read that. Try again.") instead of silently disappearing; sync status chip (Synced/Local/Google Tasks); OCR requests are authenticated. |
| **AirType** | `html5-qrcode` pinned to 2.3.8 with SRI; empty state explains pairing and has a "Start a new note" button; QR screen shows "Waiting for your phone…"/"Connected."; session rules owner-only. |
| **Photo Frame** | Preview images load through `IntersectionObserver` (no 100 MB of originals on load), delete needs a second tap, e-ink flash is now an option (default on), shared-quota wording, `_ORDER.json` is deleted when the last photo goes, "Upload photos" label, and a **Save for offline** cache so the slideshow works without Wi-Fi. |
| **Mindmap** | "+ Node" button for touch, "Double-tap" copy, dim-scrim System 7 paywall with pricing, `PRO` badge on Export (hidden for Pro), local cache + cloud fallback, username instead of email in the status bar. |
| **Dropbox** | Corrected "ReKindle account" label and the "file type type" typo. |
| **Pinterest** | Off-screen pin images are deferred with `IntersectionObserver` (Chromium 75 ignores `loading="lazy"`). |

### Tests and build

- `npm test` → **PASS** (all suites, including i18n, compatibility, Mail OAuth, worker CORS/client, Pinterest, Kindle, Substack).
- `npm run build` → **PASS** (`_deploy/main`, `_deploy/lite`, `_deploy/legacy`, sitemaps, Kindle fullscreen package).
- Targeted Playwright checks: Docs lazy editor + focus, Docs cold/warm German translation, shared paywall copy, timezone "Later", Mail draft restore, Mindmap + Node, AI empty state, AI markdown sanitisation, Mail safe-html, AirType/Pinterest/Docs inline scripts.
- Workers now verify Firebase ID tokens locally with Google's secure-token JWKS, because the Firebase API key is HTTP-referrer restricted and server-side `accounts:lookup` returns 403. Smoke-tested against production: anonymous 401, authenticated AI 200, OCR 200, Firestore Pro read 200.

### Cache/version housekeeping

- `js/i18n.js` → `v=4` on every page.
- `time.js` → `v=5` on every page.
- `pro-gate.js` → `v=7` on every page.
- `icons.js` → `v=8` in `index.html` / `index_old.html` and `sw.js`.
- `sw.js` cache name → `rekindle-cache-v27`.

---

## 2. Deployment required

The code is in the working tree but production still runs the old code. Deploy in this order:

```bash
# 1. New Mail attachment callable
firebase deploy --only functions

# 2. Workers (auth + multi-turn + quota)
cd workers/rekindle-oracle && npx wrangler deploy
cd ../rekindle-ocr && npx wrangler deploy
cd ../..

# 3. AirType session rules
firebase deploy --only database:rules

# 4. Pages build
npm run build
npx wrangler pages deploy _deploy/main --project-name=rekindle --branch=main
```

After deployment, verify:

1. **AI assistant** — signed-in Pro sends a message; anonymous `curl` against the worker returns 401; a non-Pro account returns 403; the tenth message returns 429.
2. **OCR** — Quick ToDo/QuickNotes still recognise handwriting; anonymous `curl` returns 401.
3. **Mail** — open an email with remote images (blocked until "Load images"), download an attachment, send a message with a small attachment, and check it appears in Sent.
4. **AirType** — pair a phone signed into the same account; a different account should no longer read the session.
5. **i18n** — visit a German page, then Docs/Mindmap in the same session; both should stay German.
6. **Paywall** — guest taps a Pro tile; timezone prompt no longer blocks the modal; copy/price/CTA render.

The test account password was shared for the audit and should be rotated after verification.

---

## 3. Deliberately deferred (larger projects)

These are the remaining audit items. They were not attempted or only partially addressed:

| Item | Why it is not done |
|---|---|
| **AI streaming + thread sidebar** | History and multi-turn are shipped; streaming needs an SSE/TransformStream protocol and a UI rewrite. |
| **Mail IMAP Drafts** | Sent-folder append and outbound attachments are shipped; saving drafts into the server Drafts folder still needs IMAP APPEND on a draft timer. |
| **Mastodon OAuth** | Needs dynamic app registration and a callback flow; manual token entry remains. |
| **Google Tasks code + PKCE** | Still the implicit flow, so the access token still expires roughly hourly; fixing it needs a worker-side token exchange and refresh-token storage. |
| **Dropbox upload/search and Kindle handoff** | Only the label/typo fixes shipped. |
| **Pinterest/Substack public discovery** | Both still require a connection before showing content. |
| **App-wide 48px touch targets / two sanctioned window widths / `ui-kit` + `system-dialog` adoption** | The paywall and several new controls use 48px, but the suite still has 600/650/700/800/900px windows and small toolbars. This is a visual pass across 13 apps. |
| **Read-only/export mode for lapsed Pro** | Requires Storage/Firestore rules and gate changes; a business decision as well as code. |
| **Server-side credential storage for Mail/Bluesky/Mastodon/Substack/Dropbox/Pinterest** | The AI key is now device-only, but the other integrations still use uid-derived obfuscation or plaintext tokens. Moving them to server-side refresh tokens is a project per provider. |
| **CSP** | Sanitisation and sandboxing are in place; a strict CSP needs the inline-handler refactor first. |
| **Per-user OCR quota** | OCR now requires auth + Pro; it has no daily counter. |
| **Full Mastodon/Bluesky label preferences** | Sensitive media is hidden, but user-configurable label preferences are not exposed. |

The design pass has its own detailed findings, window-width map, touch-target evidence and
acceptance checklist in [`rekindle-plus-followups-2026-10-26.md`](rekindle-plus-followups-2026-10-26.md).

---

## 4. Notes for review

- The working tree already contained **uncommitted Mail/Outlook changes** (`mail.html`, `firebase-functions/index.js`) before this work. They were preserved and shipped in the release.
- **Deployed 2026-10-26:** commit `a2a0146`; Cloudflare Pages run `40305562149`; Workers `rekindle-oracle` / `rekindle-ocr`; Cloud Functions `searchEmails`, `sendEmail`, `fetchEmailAttachment`, `fetchEmailBody`; RTDB rules. Production smoke tests passed (see the release notes in the session).
- `_deploy/` is build output, not source.
- Remaining work is product/design work, tracked in [`rekindle-plus-followups-2026-10-26.md`](rekindle-plus-followups-2026-10-26.md).
