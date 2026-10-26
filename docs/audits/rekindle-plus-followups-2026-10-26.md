# ReKindle+ follow-ups — design pass and remaining work

Date: 2026-10-26  
Status: findings recorded for later implementation. The shipped fixes are in
[`rekindle-plus-implementation-2026-10-26.md`](rekindle-plus-implementation-2026-10-26.md);
the original review is [`rekindle-plus-2026-10-26.md`](rekindle-plus-2026-10-26.md).

**Bluesky full i18n is no longer in this list** — it is implemented in the same change as
this document (pending the next Pages deploy). All 67 `bluesky.*` keys exist in the 10 locale files, including the dynamic
feed/search/notification strings, modal copy, action tooltips and 24-hour time outside
English.

---

## 1. App-wide touch/design pass — findings

This is a **cross-cutting design-system pass**, not a find-and-replace. It should happen
in one branch with screenshots at the target sizes, and it should ship app by app behind
a shared stylesheet rather than as 13 unrelated CSS edits.

### 1.1 Window widths

The 13 Pro apps currently use five different `.window` max-widths:

| Width | Apps |
| :--- | :--- |
| 600 px | Bluesky, Photo Frame |
| 650 px | Mastodon, Pinterest |
| 700 px | Quick ToDo |
| 800 px | Dropbox, AI Assistant, Files, AirType, Flipbook, Mind Map |
| 900 px | Mail, Docs, Substack |

**Target:** two sanctioned shells only — **600 px standard** and **800 px wide**.
Assign wide to Mail, Docs, Substack, Files and AI Assistant; standard to the rest.
Record the assignment in the shared stylesheet so a reviewer can spot an unsanctioned
width immediately.

### 1.2 Touch targets below 48×48

The project rule is 48×48 CSS px. The audit measured:

| App | Smallest visible control |
| :--- | :--- |
| Mail | 29–32 px toolbar controls |
| Docs | 22 px toolbar controls |
| Mind Map | 29 px controls |
| Photo Frame | 23 px controls |
| AirType | 24–45 px controls |
| Quick ToDo | 35–42 px controls |

**Target:** every tappable control gets a 48×48 hit area, either by increasing its box or
by adding a transparent 48 px wrapper. Do **not** shrink the visible 2 px border/shadow
styling; grow the padding/hit area. Recheck adjacent controls so a larger hit area does
not steal a neighbour's tap (the Report/Edit row in social apps is the known trap).

### 1.3 Shared components

- `js/ui-kit.js` is used by **Files only**. Empty/loading/error states in the other apps
  are still hand-rolled.
- **No Pro app uses `js/system-dialog.css`.** Confirmation and message dialogs are
  hand-rolled (`showMessage`, `showModal`, native-ish overlays) with different scrims,
  widths and button rows.
- The title bar/action layout differs: Mail (Settings), Docs (Back/Save), Flipbook (Back),
  Photo Frame (Upload/Start), Bluesky (Logout/New Post).

**Target:** adopt `ui-kit` for empty/error/loading states, and one `system-dialog` pattern
for all confirms/messages. Standardise title-bar slots: close, Back (optional), title,
primary action, overflow. Avoid page-local modal CSS.

### 1.4 CSS and spacing hazards

- Several older pages still use flex `gap`; Chromium 75 ignores it.
- Hover-only affordances and `transition`/`animation` declarations still exist in places;
  e-ink needs immediate state changes.
- Heading scales and toolbar heights differ between apps.
- Dark mode is global inversion; scrims must be `.rk-dark-scrim` and photos must stay
  re-inverted (see `docs/agent/dark-mode.md`).

**Target:** remove flex `gap` from the touched apps (use margins or CSS Grid), keep
transitions/animations off, and use the existing System 7 heading/button scale.

### 1.5 State coverage

Every app needs deliberate **loading / empty / error / offline / permission** states.
Files and Photo Frame now have good empty states; Mail, Mind Map, AirType and the social
apps still mix loading text, blank panes and raw error strings.

### 1.6 Recommended execution order

1. Build `pro-app.css` (tokens + shell + buttons + title bar) and a visual checklist.
2. Pilot on **Mail** and **Docs** (widest, most-used, already touched).
3. Files, Quick ToDo, Photo Frame.
4. Flipbook, AirType, AI Assistant.
5. Social/reading apps: Mastodon, Bluesky, Pinterest, Substack, Dropbox, Mind Map.
6. Full-suite screenshot review at 800×1000, 600×800, German, dark mode and 1× zoom;
   confirm 48 px targets and no horizontal scroll.

**Effort:** 3–5 days for the suite; 1–2 days for the five highest-traffic apps.  
**Risk:** medium — visual regression, not data loss. Do not combine with logic changes.

---

## 2. Remaining product work

| Item | What is left | Why it is deferred |
| :--- | :--- | :--- |
| **Mail IMAP Drafts** | Local compose drafts + restore, Send, Sent append and attachments shipped. Server-side Drafts folder needs IMAP `APPEND` on a debounce timer, conflict handling and a Drafts-folder picker. | Requires a state machine and live IMAP testing; local drafts cover the offline case. |
| **Mastodon OAuth** | Manual access-token entry remains. Needs dynamic app registration, redirect/callback, token refresh and encrypted storage. | Each instance is a different OAuth server; needs a real app registration and callback URL. |
| **Google Tasks code + PKCE** | Still the implicit flow, so tokens expire roughly hourly. Needs a Google Cloud OAuth client, PKCE verifier, worker-side code exchange and refresh-token storage. | Requires a Google Cloud console change and a server secret/refresh store; not a pure client fix. |
| **Dropbox upload/search** | Listing/download work; upload, conflict handling, progress and `filesSearchV2` are still absent. | Needs write scopes on the Dropbox app and careful duplicate-name handling. |
| **Pinterest/Substack public discovery** | Both require a connection before showing content. | Pinterest has no public search API for this use; Substack discovery needs curated/public feeds and a proxy. |
| **Strict CSP** | Sanitisation/sandboxing shipped; a strict CSP needs removal of inline `onclick`/`<script>`/styles or nonces/hashes, plus Firebase/Cloudflare allowances. | Large, page-wide refactor; start with `Content-Security-Policy-Report-Only`. |
| **Read-only/export mode for lapsed Pro** | Paywall blocks writes and most reads. A read-only mode needs gate states, per-app read paths, Storage/Firestore rules and a product decision on export. | Business decision plus rules; easy to accidentally leave a write path open. |
| **Server-side credential storage** | Mail/Bluesky still use uid-derived encryption; Mastodon/Substack/Dropbox/Pinterest tokens are client-side. AI is device-only. | One project per provider; needs refresh-token storage and rules. |
| **AI streaming + thread sidebar** | Multi-turn and history shipped; streaming needs an SSE/TransformStream protocol and a chat UI rewrite; a thread sidebar needs conversation indexing. | Kindle performance risk and a large UI change. |
| **Per-user OCR quota** | OCR requires auth + Pro, but has no daily counter. Mirror the Oracle Firestore quota. | Abuse prevention, not a user-facing gap; measure usage first. |
| **Bluesky label preferences** | Sensitive media is hidden by default. User-configurable label preferences are not exposed. | Needs a settings surface and per-label policy; small product decision. |

---

## 3. Acceptance checks for the design pass

- [ ] Every app uses 600 px or 800 px, with the assignment documented.
- [ ] Every tappable control is at least 48×48 px at 1× zoom.
- [ ] No flex `gap`, `aspect-ratio`, `min()`/`max()`/`clamp()`, `?.` or `??`.
- [ ] All confirms/messages use the shared dialog; all empty states use `ui-kit`.
- [ ] German and English screenshots at 800×1000 and 600×800; no clipped labels.
- [ ] Dark mode: scrims/dim overlays use `.rk-dark-scrim`; photos/QR codes stay legible.
- [ ] `npm test` and `npm run build` pass; service-worker stamp changes.
- [ ] Manual Kindle/e-ink check, not only headless Chromium.

---

## 4. Notes

- Bluesky’s static markup uses `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`;
  dynamic strings use `bskyText()` with English fallbacks and `tFormat`-style `${...}`
  interpolation. Do not add `data-i18n` to the dynamic compose title or action tooltips.
- Mail’s Sent copy and attachments are best-effort: a failed IMAP append must never turn
  a successful SMTP send into an error.
- The 2026-10-26 release notes and exact verification commands are in the implementation
  report. The production deploy is tracked there; this document is source-only backlog.
