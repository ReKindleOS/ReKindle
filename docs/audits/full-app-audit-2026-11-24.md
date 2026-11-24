# Full-app audit — 2026-11-24

Whole-app bug hunt and improvement pass over the ReKindle dashboard and its 145 root
pages. **Status: the first fix batch has now shipped** (the fixes are listed in
[Fixes shipped in this pass](#fixes-shipped-in-this-pass) below and were verified with
`npm test` plus runtime probes on every changed page). The sections after that table are
the original findings, kept for context and for the work that is still open.

## How it was tested

| Check | Coverage | Result |
| :--- | :--- | :--- |
| `npm test` (40 suites) | repo-wide static/rules/worker tests | **PASS** |
| Runtime probe, WebKit, 800×1000, cold profile | **all 145 root pages**, 3 sweeps (en, 600×800 and `?lang=de` spot checks) | 3 load-time JS errors, 2 raw i18n keys, 0 missing local assets (the `/api/*` 404s are expected on the local static server) |
| ES2019 parse (acorn) of every inline script + browser `.js` | all browser JS | **0 errors**; no `?.`/`??` in app code |
| Inline `<script>` `new Function` compile | 145 pages | **0 syntax errors** |
| Asset + internal-link integrity | every `img/script/link/css url()/a href` | 0 missing local assets, 0 broken internal links |
| Duplicate ids, `getElementById` targets, inline-handler targets | 145 pages | 0 duplicate ids; 5 undefined handlers (2 dead markup) |
| External endpoints | NYT proxy, GitHub crossword archive, map style, unpkg | all 200 |
| Visual review | 145 screenshots at 800×1000, contact sheets + zoom | consistent overall; list below |

Screenshots were captured with `scripts/shot-webkit.sh`; the runtime probe additionally
reports console errors, uncaught rejections, broken images, overflow, animations,
sub-12px text, sub-44px targets, raw `${…}`/`undefined`/`NaN`/`[object Object]` text and
raw locale keys.

**Not covered:** a real Kindle/e-ink device, the 14 ReKindle+ apps behind auth
(Bluesky, Mail, Substack, Dropbox, Pinterest, Mastodon, Photo Frame, Flipbook, AirType,
Docs, AI Assistant, Files, Mind Map, Quick ToDo), payment/Stripe flows, multi-user live
games, and cross-device sync.


## Fixes shipped in this pass

All fixes are committed as `f4a0f02` and pushed to `main`; the Pages production
deployment is live on branch `main` at that commit. Shared-asset versions were bumped as
required by AGENTS.md: `theme.js?v=36` (143 pages + `sw.js`), `pro-gate.js?v=12`
(14 pages), `js/custom-select.js?v=3` (27 pages).

**Worker deploy status (2026-11-24):** deployed to the separate "ReKindle Social"
Cloudflare account (`8d69e380e0c4e0580c47f21d9757c71c`) with the token documented in
`docs/agent/usage-limits.md`. Live deployment `cc9d0656-a974-4100-8b81-1d383c9b298d`
(2026-11-24T04:57Z) at `https://rekindle-moderate.rekindle-social.workers.dev`;
`/health` returns `ok:true`, `openaiKeySet:true`, and the CORS preflight returns 204 with
`Access-Control-Max-Age: 86400`.

| Area | Fix | Files |
| :--- | :--- | :--- |
| Report integrity | The moderation worker now reads the reported message/comment/post from Firestore/RTDB server-side for **every** content type; the client `contentSnapshot`/`contentPath` is never trusted for the verdict, and an unresolvable report is held instead of auto-deleted. | `workers/rekindle-moderate/worker.js` |
| Stored XSS | Reaction keys render as text unless they are a known SVG; player names escaped in all seven live lobbies; feed titles/snippets/images escaped; Open Library descriptions and Wikipedia parse HTML go through `safe-html.js`; both article iframes are `sandbox="allow-same-origin"`. | `kindlechat.html`, `liveuno/chess/checkers/connect4/dotsandboxes/tictactoe/yahtzee.html`, `rssreader.html`, `newspaper.html`, `books.html`, `wikipedia.html` |
| Suggestions policy | Link + competitor-promo guards added to create, edit and comment paths; display censoring chains the promo mask. | `suggestions.html` |
| Load-time errors | Bare `async` removed (sheetmusic); `currentUser` declared and DST offset computed at the event's wall time (calendar); `updateUI()` → `updateBankDisplay()` (blackjack). | `sheetmusic.html`, `calendar.html`, `blackjack.html` |
| i18n | English fallbacks for the computed 2P turn keys (no more `checkers2p.turn.black` / `connect4.turn.p1`). | `2pcheckers.html`, `2pconnect4.html` |
| Data integrity | Journal cache is per-account; flashcards keep `add()` ids in memory (add + import); Quick ToDo no longer deletes the Tasks guest key; user text escaped in tasks/notes/streak/countdown/contacts. | `journal.html`, `flashcards.html`, `quicktodo.html`, `tasks.html`, `notes.html`, `streak.html`, `countdown.html`, `contacts.html` |
| Game state | Tetris Retry clears the board and restarts, and the canvas transform no longer compounds; checkers counts each finished game once; Connect 4 / Tic-Tac-Toe render before highlighting the win line; leaderboard submits catch failures; Pictionary scores use `ServerValue.increment`; Yahtzee's lobby countdown uses server time and stops for guests. | `tetris.html`, `checkers.html`, `connect4.html`, `tictactoe.html`, `circle.html`, `maze.html`, `snake.html`, `livepictionary.html`, `liveyahtzee.html` |
| Broken controls | Wikipedia Enter runs the real search handler; Substack's subscription search is implemented and the missing fallback icon is an inline SVG; RSS multi-word filters no longer throw; converter's dead click handler removed; Dropbox retries once after a successful 401 refresh. | `wikipedia.html`, `substack.html`, `rssreader.html`, `converter.html`, `dropbox.html` |
| Shared behaviour | Pro-gate stops its 2 Hz scan once Pro is known and a cache-write failure no longer blocks a paying user; `theme.js` no longer swallows the second tap on interactive elements; the custom-select trigger is focusable and Enter/Space/Escape work; DM send guard matches the chat path (30 s). | `pro-gate.js`, `theme.js`, `js/custom-select.js`, `kindlechat.html` |

**Verification:** `npm test` PASS (all 40 suites, including new assertions in
`scripts/test-reports.js` that pin the server-side resolution and the hold-on-unresolved
rule), `scripts/test-compat.js` PASS,
`scripts/test-i18n.js` PASS, a static sweep of all 145 pages reports 0 JS syntax errors
and 0 missing assets, and targeted runtime probes confirmed: no load errors on all
changed pages, Tetris restart clears the arena, a $0 bankroll tops up to $100, the
journal key is uid-scoped, `filterSubs`/`containsUrl` exist, the 2P status labels are
English, the guest paywall still gates Mail, and the RSS/Newspaper iframes carry the
sandbox attribute.

### Re-audit with a Pro account (2026-11-24)

A ReKindle+ test account was used to load 27 signed-in pages (the Pro flag and the
`pro` claim were both active). Results:

- 0 console errors, 0 failed requests, 0 broken images, 0 raw locale keys, 0 horizontal
  overflow on every signed-in page.
- `pay`, `membership` and `settings` correctly show an active ReKindle+ membership;
  Mail rendered a real inbox; Files showed the 100 MB Pro quota; Notes/Books/Tasks/Journal
  loaded their signed-in state; Suggestions rendered the full board.
- The social pages (KindleChat, Topics, Neighbourhood) correctly stop at the **age
  verification** dialog for this account, so their signed-in content flows were not
  exercised. The integration pages (Substack, Dropbox, Pinterest, Mastodon, Bluesky)
  correctly showed their "connect account" state because this test account has no linked
  services.
- Layout measurements on the signed-in pages: Suggestions has the most sub-44 px
  controls (134, mostly list/upvote affordances) and sub-12 px text (60 nodes);
  Settings and Mind Map follow. This is the app-wide touch/typography item, not a new
  regression.
- Authentication note for future audits: a WebKit-based harness cannot complete the
  Firebase sign-in (the SDK sends `referrerPolicy: no-referrer` and the project API key
  requires an Origin/Referer), so the Pro pass was run in Chromium. That is a harness
  limitation, not an app bug — normal browsers send Origin.


---

## P0/P1 — security and data integrity

### 1. Any signed-in user can auto-delete anyone's message by forging the report snapshot
`workers/rekindle-moderate/worker.js:3123` → `:3200` → `:3236`

```js
let reportContentSnapshot = (contentSnapshot || "").substring(0, 2000);   // 3123
const mod = await moderateContent(reportContentSnapshot, …);              // 3200
const deleted = await autoDeleteContent(contentType, contentId, reportContentPath, …); // 3236
```

For every type except `dm_message` (which fetches the text server-side at `:3129-3150`),
`contentSnapshot`, `contentId` and `contentPath` are **client-supplied**. Post a report
whose snapshot contains an obvious slur → OpenAI flags the forged text → the real
target message/comment is deleted by the service account. Five deletions per 12 min per
report bucket; rotating accounts removes the cap. This re-opens the exact abuse the
2026-10-26 "one reporter cannot delete alone" rule was meant to close.
**Fix:** fetch `contentId`/`contentPath`/text from RTDB/Firestore server-side for every
type (the DM branch is the model) and ignore the client snapshot for the verdict.

### 2. Stored XSS in KindleChat reactions
`kindlechat.html:6110` + `emojis.js:203`

```js
el.innerHTML = reactionDisplay + ' ' + count;   // kindlechat.html:6110
return REACTION_SVGS[svgKey] || reactionKey;     // emojis.js:203 — raw key falls through
```

`kindlechat/messages/{id}/reactions/{uid}.reaction` is written by clients and the social
RTDB rules only require the child to exist. A reaction value of
`<img src=x onerror=…>` executes for every viewer.
**Fix:** append a text node when `REACTION_SVGS[key]` is missing, and add a `.validate`
whitelist on `reaction` in `rtdb-social-rules.json`.

### 3. Stored XSS via player names in seven live-game lobbies
`liveuno.html:813`, `livechess.html:727`, `liveyahtzee.html:661`/`:1093`,
`livecheckers.html:701`, `liveconnect4.html:672`, `livedotsandboxes.html:624`,
`livetictactoe.html:720`

`p.name` is interpolated into `innerHTML` while other lines in the same files already use
`escapeHtml(p.name)` (e.g. `liveuno.html:1169`, `liveyahtzee.html:901`). Any authenticated
client can write `games/{game}/{matchId}/players/{uid}/name` directly
(`rtdb-rules.json:128-130` is `auth != null`), so a hostile lobby name runs in every
player's page.
**Fix:** escape every `p.name`/`p.uid` in the lobby and scoreboard renderers.

### 4. Third-party HTML rendered with `innerHTML` (stored XSS / layout corruption)
AGENTS.md requires `js/safe-html.js` for rich third-party text; these pages do not use it:

| Page | Line | Sink |
| :--- | :--- | :--- |
| `rssreader.html` | `1835-1841` | `${article.source}`, `${article.title}`, `${article.snippet}`, `${article.image}` from every subscribed feed |
| `books.html` | `859` | `blurbBox.innerHTML = details.description` (Open Library community data) |
| `wikipedia.html` | `431` | `data.parse.text['*']` straight into `article-body` |
| `newspaper.html` / `rssreader.html` | `484` / `818` | article iframe gets a `blob:` document with **no `sandbox`**, inheriting the app origin (access to Firebase auth/localStorage) |

**Fix:** `escapeHtml` for titles/sources, `rekindleSetSafeHtml` for descriptions/article
bodies, and `sandbox="allow-same-origin"` (no `allow-scripts`) on both iframes.

### 5. `suggestions.html` bypasses the link/promo ban completely
`suggestions.html:2410` (create), `:2483` (`censorText`)

Suggestions write straight to RTDB; the page loads neither `js/link-guard.js` nor
`js/promo-ban.js`, and `censorText` only runs `filterBadWords`. A title like
`kindlehub.pro — new chat app` is stored and shown to every reader forever. The
moderation worker only handles *deletion* for suggestions, not creation.
**Fix:** add both guards to create/edit/comment and chain
`rekindleCensorPromotedTerms` into `censorText` (or route writes through the worker).

### 6. `sheetmusic.html:1198` — a lost `async` head kills the rest of the page script
```
        async         // Cap the composer-image cache. Every lookup used to write a new
```
Valid via ASI (so `test-compat` passes) but evaluates an undefined identifier →
`ReferenceError: Can't find variable: async` on every load. Consequences:
`IMG_CACHE_MAX`/`IMG_CACHE_LRU_KEY` never initialise (the unbounded `rekindle_img_*`
cache returns — the BL-20 64 MB cache-wipe regression), `const NOTE_NAMES` stays in TDZ
so viewing a `.mid` file throws, and `updatePlaceholder()` never runs.
**Fix:** delete the bare `async`. Add a lint that rejects an expression statement that is
a lone keyword.

### 7. Calendar guest path throws and DST offsets are computed from *today*
`calendar.html:1170-1175` + undeclared `currentUser`

* `currentUser` is never declared (`grep "let currentUser"` → 0), so guest
  `onAuthStateChanged` → `initNativeMode()` reads an undefined identifier
  (`calendar.html:2064`) and the rejection shows in the console.
  **Fix:** `let currentUser = null;` beside `let events = []` (line 1179).
* `getUTCFromWallClock()` derives `offsetMs = zonedNow - now` — the **current** UTC offset
  — and applies it to any date. An event saved for a date on the other side of a DST
  change is stored one hour off (verified with Europe/London: a 09:00 December event is
  stored as 08:00), and the wrong time is written to Google Calendar too.
  **Fix:** compute the offset at the target wall clock, not now (probe
  `Date.UTC(y, m-1, d, h, min)` through `rekindleGetZonedDate`).

### 8. Journal cache is device-global and is pushed into the next account
`journal.html:848`, `:897`, `:940-951`

`NOTES_CACHE_KEY = 'rekindle_journal_cache'` has no uid. On a shared Kindle, user B loads
A's cached notes before auth, then the merge (`l.updated > c.updated → toPush`) writes
A's newer entries into **B's** `journal` collection. Note ids are dates, so a day both
users wrote is overwritten by A's text with no user action. Nothing clears the key on
logout. `notes.html` has the same device-global cache (titles visible until the snapshot
lands, less severe).
**Fix:** suffix the key with the uid and discard/ignore it when `rekindle_uid` differs.

### 9. Blackjack: load error, $0 soft-lock, biased shuffle
* `blackjack.html:393` calls `updateUI()`, which does not exist (the functions are
  `updateBankDisplay`/`renderHands`) → `ReferenceError` on every load; a restored
  bankroll is not shown until the player bets. **Fix:** call `updateBankDisplay()`.
* `:428-432` + `:631-639`: the mercy top-up only exists in `loadGameData()`. Bust to $0
  and every bet answers "Not enough chips!" forever; the page must be reloaded.
* `:425` `d.sort(() => Math.random() - 0.5)` is a biased comparator shuffle (same pattern
  solitaire moved off in 2026-11-24).

### 10. Tetris: Retry does not restart; Back breaks the canvas scale
* `tetris.html:695` — `if (gameOverModal.style.display === 'block' || player.score > 0)` is
  tested *after* line 694 sets it to `'none'`, and the arena is only wiped inside that
  branch. `playerReset()` re-tests the uncleared stack, collides, and shows GAME OVER
  again. **Fix:** add `restartGame()` that clears `arena`, resets `score`/`isPaused`
  before calling `playerReset()`, and point Retry at it.
* `tetris.html:469` `context.scale(20, 20)` runs on every `pageshow` re-init
  (`:434-437` → `initGame()`), composing to 400× after a Back navigation.
  **Fix:** `context.setTransform(20, 0, 0, 20, 0, 0)`.

### 11. Checkers 1P win/loss stats increment on every reload of a finished game
`checkers.html:946-952` calls `recordGameEnd()` whenever `game.winner` is set; `game.load()`
restores `winner` and the init path calls `checkStatus()` again. `loadStats()` is async and
not awaited, so the increment can run against default `{wins:0,losses:0}` and then
overwrite the cloud doc. Chess already guards with `gameActive`; checkers does not.

---

## P2 — visible bugs and correctness

| # | Where | Symptom / fix |
| :--- | :--- | :--- |
| 1 | `2pcheckers.html:743`, `2pconnect4.html:457` | Turn label shows raw keys `checkers2p.turn.black` / `connect4.turn.p1` in English (`window.t(computedKey)` without a fallback; `en.json` is never fetched). Pass the English fallback like `2pchess.html:537`. |
| 2 | `wikipedia.html:315` | `onkeypress="handleKey(event)"`; the function is called `handleEnter` (`:341`) → Enter throws and does not search. |
| 3 | `substack.html:632` | Subscription search calls `filterSubs()`, which does not exist → error per keystroke, nothing filters. |
| 4 | `rssreader.html:1159` + `:1533` | Filter button ids are slugified (`Tech-News`) but `setFilter()` looks up `filter-Tech News` → `null.classList` error for every multi-word category, no filter applied. |
| 5 | `substack.html:1523,1527,1574` | Fallback `rss_icon.png` does not exist → broken-image box and a repeating 404. |
| 6 | `converter.html:345` | `onclick="focusInput()"` — no such function, no input to focus. |
| 7 | `flashcards.html:930` | `add(newCard)` drops the returned ref and never pushes to `cards`; imported/added cards are invisible until reload, reviews save against `doc(undefined)`, and "delete deck" orphans them. |
| 8 | `quicktodo.html:668` | Migration copies `rekindle_tasks_local` to a uid-scoped key then **removes the source**, but `tasks.html:915` still reads the shared key → guest tasks disappear from Tasks. |
| 9 | `tasks.html:907`, `notes.html:755`, `streak.html:723`, `countdown.html:828/864`, `contacts.html:186-190` | User text interpolated into `innerHTML` unescaped; the helpers already exist but are unused. Titles containing `<`/`&` corrupt the row. |
| 10 | `dropbox.html:1379` | 401 + successful token refresh returns without retrying, leaving "Loading…" forever. `if (refreshed) return loadFolder(path);` |
| 11 | `chords.html:518` | Guest-saved songs are stranded after sign-in: the auth branch renders only the Firestore snapshot and never uploads `rekindle_chords`. |
| 12 | `pixel.html:1001`, `flipbook.html` | KindleChat opens art with `?source=kindlechat`, but `#back-to-chat-btn` does not exist and flipbook ignores the param → no way back to chat. |
| 13 | `liveyahtzee.html:676,694` | Lobby countdown compares the host's `Date.now()` with each guest's clock (no `.info/serverTimeOffset`) — guests with skewed Kindle clocks show "Starting in 1215s…" or 0; the interval also never clears for guests. Copy `liveuno.html`'s `serverTime()`. |
| 14 | `livepictionary.html:1563-1568` | Scores are read-modify-write from a stale snapshot; simultaneous guesses lose/double the drawer award. Use `ServerValue.increment`. |
| 15 | `kindlechat.html:4173` | DM send unlocks after 4 s while the POST may still be in flight (general chat uses 30 s at `:6288`); a slow Kindle can double-send. |
| 16 | `kindlechat.html:6242-6254` | Reply prefix is inserted before URL/promo/length validation; a rejected send leaves `@user` and `replyTarget` armed. |
| 17 | `kindlechat.html:3388`, `neighbourhood.html:3058` | Window-slide `child_removed` events on `limitToLast` queries remove paginated, still-existing posts from the DOM; only a reload restores them. |
| 18 | `connect4.html:514-516`, `tictactoe.html:402-405` | `highlightWin()` runs before `renderBoard()`, which rebuilds the board and discards the `.winner` class — the winning line is never shown. |
| 19 | `strands.html:614-617` | Failed puzzle fetch retries every 1.5 s forever; no backoff/attempt cap/stop button. |
| 20 | `circle.html:688`, `maze.html:579`, `snake.html:508`, `tetris.html:516` | `RekindleScores.submit(...)` is fire-and-forget; failures become unhandled rejections and the player is never told. |

### Shared frontend

| # | Where | Finding |
| :--- | :--- | :--- |
| S1 | `theme.js:891-899` | Deliberate double-tap-zoom guard, but it also swallows the second tap on game cells, keypads and tiles (only inputs are exempt), so a fast re-tap on a button that did not visibly respond emits no `click`. Exempt `a,button,[onclick],label,canvas` while keeping the zoom block. |
| S2 | `pro-gate.js:313-363` | A 2 Hz `setInterval` re-serialises **every** `<style>` element and runs 3 regexes forever on 14 pages, with no `clearInterval` and no `document.hidden` guard. Clear it once Pro is known; skip hidden tabs. |
| S3 | `pro-gate.js:195-260` | The Pro-cache `localStorage.setItem` shares the `try` with the Firestore read; a storage failure (documented Kindle quota/cache wipe) sends a paying user to `gateOrHide('Error verifying subscription.')` unless a valid uid-matched cache exists. Wrap storage in its own try/catch. |
| S4 | `time.js:100-113` | Intl with `timeZone` is tried **before** the stored manual UTC offset. AGENTS §5 warns that Kindle's Intl often ignores the zone silently (no throw), in which case the offset never applies and times render in device/UTC time. Verify on a Kindle; if confirmed, prefer the manual offset and use Intl only for the DST correction. |
| S5 | `js/custom-select.js:25-33`, `css/custom-select.css:14,60` | ~34 px trigger/rows (48 px required) and no `role`/`tabindex`/keyboard handler — the native select is `display:none`, so keyboard users cannot change it. 27 pages + modals. |
| S6 | `theme.js` (`defer` on `index.html:84`, `login.html:21`, `index_old.html:79`) | Theme/scale/dark filter and the viewport rewrite land after a 180 KB document parses → flash of unscaled/light dashboard. The other 140 pages load it synchronously. |
| S7 | `js/i18n.js:376, 479` | Three full-document `querySelectorAll` translation passes at DOMContentLoaded; English (the default) has no translations, so all are no-ops. |
| S8 | `theme.js:232`, `index.html:203` | `.dashboard` and `.desktop-wrapper` are both zoomed, then the page undoes one locally (squared zoom at auto-scale). Drop `.dashboard` from the shared zoom list. |
| S9 | `pro-gate.js`/`theme.js`/`ui-kit.js`/`time.js` | Injected UI uses 0.7–0.78rem text (paywall benefits/status, empty-state hint, TZ label). Bump to 0.8–0.85rem. |

---

## Design / UX observations (from the 145 screenshots)

* **Slow first paint has no loading state.** Wordle, Maps, Crossword, KindleChat,
  Neighbourhood and Topics render an empty window for 3–6 s on this fast local server
  while auth/fetch resolves (Wordle: board and keyboard only appear after Firebase auth +
  the NYT word; Maps: blank until MapLibre/style load; Crossword: "Loading Puzzle…" with a
  black canvas). On a Kindle this is much longer and looks broken. Add the static grid /
  skeleton immediately and gate only the data.
* **Sub-12px text on 73 pages** (measured). Densest: `cargames` (92 nodes), `words` (67),
  `crossword` (46), `preview` (34), `pet` (24), `pixel` (22), `moderation` (20),
  `login` (16), `help` (14). Worth a deliberate "minimum 12 px body text" rule for e-ink.
* **Touch targets:** 144/145 pages contain at least one control under 44 px. Some of that
  is the deliberate 18 px title-bar X; the real problems are 22–35 px toolbars in the Pro
  apps, game keypads and social action rows (already listed in
  `docs/audits/rekindle-plus-followups-2026-10-26.md` §1.2 — still open).
* **Modals are still inconsistent:** 78 pages use a `.modal-box` without the shared
  `js/system-dialog.css` (13 pages use it). Chess/Checkers/2P new-game dialogs, Docs,
  snake, Lights Out etc. render as plain white boxes next to the striped System 7 cards.
* **Window widths** still span 600–900 px (documented in the ReKindle+ follow-ups); the
  compact games (2048, Dino, Horse?) leave large grey margins at 800 px.
* **Glyphs to verify on a real Kindle:** chess pieces (`2pchess`), card suits
  (`solitaire`), and single glyphs `☺ ✎ ☆ ⚙ ♠` appear as text. They are not emoji, but if
  the Kindle font lacks them they become tofu — the one thing a screenshot on WebKit cannot
  prove.
* Otherwise the System 7 shell is consistent: striped title bars, hard shadows, no
  gradients, no running animations in e-ink mode, and the dashboard/help/On This Day/News
  screens are the strongest-looking pages.

---

## Test gaps this sweep exposed

`npm test` is green but would not catch any of the above. Cheap additions:

1. A "bare keyword statement" lint (the sheetmusic `async`).
2. An inline-handler resolution test (the 5 undefined handlers found: `focusInput`,
   `filterSubs`, `handleKey`, plus dead `startNewGameAction`/`closeModal`/`closeConfirmModal`
   in never-opened modals).
3. A probe asserting no visible text matches a locale key (`^[a-z]+(\.[a-z0-9_]+)+$`) —
   catches the two computed-key cases `test-i18n` cannot see.
4. A worker test that a forged `contentSnapshot` cannot trigger auto-delete.
5. A `theme.js`/`pro-gate.js` interval-leak check (timers cleared on pagehide/after Pro).
6. An XSS sink test for the shared social/reading renderers, mirroring the existing
   link-guard parity test.

## Suggested order for the remaining work

1. KindleChat reply prefix is still inserted before URL/promo/length validation
   (`kindlechat.html:6242`), and the window-slide `child_removed` handlers still remove
   paginated messages that still exist (`kindlechat.html:3388`,
   `neighbourhood.html:3058`).
2. A11y/typography: 48 px `custom-select` boxes and options (keyboard is now wired),
   22–35 px Pro-app toolbars, and the 73 pages with sub-12 px text.
3. Loading states: Wordle/Maps/Crossword/KindleChat/Neighbourhood/Topics still show an
   empty window for several seconds while auth/data resolves.
4. `time.js` Intl-vs-manual-offset ordering (verify on a Kindle first).
5. `theme.js` `defer` flash on `index.html`/`login.html`/`index_old.html`.
6. i18n's three DOMContentLoaded full-document passes (`js/i18n.js:376,479`).
7. Guest-library merge in `chords.html`, the "back to chat" affordance in
   `pixel.html`/`flipbook.html`, and the `custom-select` per-instance document click
   listeners.
