# Help & FAQ App (`help.html` + `help-data.js`)

The in-app manual. It is a single-page knowledge base with search, category
browsing, deep links (`/help#tasks`) and an A-Z app index.

## Files

| File | Purpose |
| :--- | :--- |
| `help.html` | System 7 shell, routing, search, A-Z index, article renderer, text-size control. |
| `help-data.js` | `HELP_CATEGORIES` and `HELP_ARTICLES` (142 guides, English copy). No network requests. |

`help-data.js` is loaded with `?v=12` in `help.html`. **Bump that query when the
data changes** so edge/service-worker caches cannot serve an old guide set. The
page itself is included in the generated sitemap automatically.

Badge labels beyond the app-icon set render in the article header:
`HIGHLY EXPERIMENTAL` gets the inverted `.badge.exp` style (used by the jailbreak
launcher guide). Warning callouts use `<div class="note warn">` (white box with an
8px left bar). Keep both in `help.html` when adding a warning article.

## Article model

```js
{
  id: 'tasks',              // unique; hash/deep link (#tasks)
  cat: 'productivity',      // must match HELP_CATEGORIES.id
  title: 'Tasks',
  summary: 'One-line description used in lists/search.',
  body: '<p>Trusted HTML...</p>',
  tags: 'extra search words',
  badges: ['REKINDLE+'],    // optional: REKINDLE+, NEW, HIGHLY EXPERIMENTAL, 1P, 2P, LIVE
  appHref: 'tasks',         // optional: page to launch (without .html)
  appName: 'Tasks',
  related: ['notes'],       // optional article ids
  sub: 'Word games'         // optional; only games use this grouping
}
```

Search builds an index from `title + keywords + summary + tags + body` at load.
`keywords` is not rendered; use it for synonyms (e.g. "login" for account,
"8 ball" for pool, "spelling bee" for spellbound). Keep summaries under ~160
characters. `renderCategory()` sorts games by the `SUB_ORDER` map in
`help.html` (Start here, Word games, Logic & puzzle, Cards & board, Action &
arcade).

## Coverage rules

- **Every home-screen app needs a guide with `appHref`.** The A-Z index is built
  from articles that have `appHref`, so a missing one makes the app undiscoverable
  in Help.
- Game variants (`2pchess`, `livechess`, etc.) do not need their own entries;
  their parent guide and the "Single, local and live modes" table cover them.
- Unlisted/administrator pages (`jumpy`, `texasholdem`, `words`, `cookieclicker`,
  `manga`, `login`, `moderation`, `quicknotes`, `index_old`, `changelog`, `probe`) are
  described in "Unlisted & legacy pages". Unlisted games may keep a full guide
  with `appHref` and an "Unlisted" note (cookieclicker) so they stay launchable
  from the A-Z index; if one is promoted to the home screen, drop the note.
- **Readwise is listed, not unlisted:** `icons-beta.js` pushes it into `APPS`
  (with `beta: true`), so it keeps its `appHref` and BETA badge.
- The Help app documents itself (`id: 'help'`, `appHref: 'help'`). It is not in the app drawer; the top menu and About panel link to it.

## UI / i18n notes

- The **article content is English**. Only the shell is localised: `help.title`,
  `help.search.label`, `help.search.placeholder`, `help.nav.index`,
  `help.nav.home`, `help.font.smaller`, `help.font.larger` in `locales/en.json`.
  Any new static `data-i18n` key must be added to `en.json` (the i18n test
  enforces this); other locales fall back to the inline English.
- Do not put `data-i18n` on JS-rendered article text - the loader would overwrite
  it with a raw template.
- Use ASCII only (no emoji). The Kindle browser has no colour emoji font.
- Keep CSS Chromium-75 safe: no flex `gap`, `min()`/`max()`/`clamp()`,
  `aspect-ratio`, `position: sticky` or `inset`. Grid `gap` is fine.
- Search is debounced by 140ms. `?q=search` is supported, but note that
  `theme.js` strips `.html` from the URL and drops the query when a page is
  loaded as `/help.html?q=...`; test with the extensionless `/help?q=...`.

## Verification

```bash
node scripts/test-i18n.js && node scripts/test-compat.js
scripts/shot-webkit.sh "http://127.0.0.1:8899/help" 800 1000 /tmp/help-800.png
scripts/shot-webkit.sh "http://127.0.0.1:8899/help" 600 800 /tmp/help-600.png
scripts/shot-webkit.sh "http://127.0.0.1:8899/help" 800 1000 /tmp/help-task.png 'location.hash="tasks";'
```

Check: 800px two-pane layout, 600px stacked category strip (3 rows max), long
tables fit at 600px, article text size persists via `rekindle_help_font`, and the
top-menu Help link (and the About-panel Help link) opens the page. Help is intentionally **not** in the app drawer.

## When an app changes

1. Update or add its article in `help-data.js`.
2. If the app is new to the home screen, set `appHref`/`appName` and add a
   registry entry in `icons.js`.
3. If `icons.js` changes, bump its `?v=` in every page that includes it (currently
   `icons.js?v=4`) and in `sw.js` `ASSETS_TO_CACHE`.
4. Bump `help-data.js?v=` in `help.html`.
5. Run `npm test` and rebuild.

## FAQ: billing and refunds (2026-10-24)

The FAQ had cancel instructions but no refund answer, which is why billing
complaints kept arriving as public Suggestions posts. Added a **"I paid but Pro
is missing, or I need a refund"** section: email `support@rekindle.ink` from the
checkout address with username/date/amount, never post card details, check
Manage Subscription first, and treat cancellation (stops renewal) separately
from a refund (case by case). The Suggestions board's triage strip links to
`help#faq` and `help#support`, and its Suggest an idea guide now explains the
"Load older" window and the duplicate finder. Bump `help-data.js?v=` in
`help.html` after any copy edit (currently `?v=12`).

## Content audit (2026-10-26)

A full pass checked every article against the page source. Rules for future edits:

- **Do not repeat a privacy or storage claim without reading the write path.**
  Examples fixed: Life Calendar saves the birthday to the public social profile
  (`users_public/{uid}`), Dropbox and Mail store tokens / encrypted passwords in
  Firestore `pro_data`, and Mail's AES key is derived from the uid - convenient
  sync, not a security boundary.
- **Check whether a control exists before naming it.** Common drift: a "Sync"
  button that is automatic, month arrows that are infinite scroll, a "Read"
  button that is a tappable title, a "Contents" control only in the Gutenberg
  viewer, and a "Sync Google Calendar" button that is a first-run Use Google /
  Log In pair.
- **Counts and units drift.** Keep ranges, quotas and units in the article
  matching the code: 10 AI messages/day, 3 stock ranges, 4 timer tabs, 2 RSS
  tabs, 100 MB shared Files quota, flashcards' 1d/6d/ease schedule, calculator
  trig in degrees.
- **Dates and statuses drift fastest.** Dark mode, Outlook/Hotmail Mail,
  Delete Account, the password reset and the Changelog page all changed in the
  last week of October 2026. When a feature ships, update the app article, the
  FAQ, `whats-new` if it is user-visible, and `hidden-legacy` if a page became
  reachable or retired.
- **Search for stale absolutes** before shipping: `temporarily disabled`,
  `not supported`, `coming soon`, `no self-service`, `not written to`,
  `all times`, `four ranges`.
