# Home screen / dashboard — functional and performance proposals (2026-11-24)

Companion to the shipped visual pass on `index.html` (see
[visual-audit.md](../agent/visual-audit.md#2026-11-24-dashboard-polish-indexhtml)).

> **Status 2026-11-24: every P1–P3 item below is implemented in the working tree**
> (not pushed). The original proposal text is kept as the design rationale; the
> implementation notes and measured result are at the bottom of this file.
>
> **Line references in the P1–P3 sections describe the pre-implementation
> `index.html`.** That file is now 469 lines; the dashboard logic lives in
> `js/home.js`, the styles in `css/home.css`, and Firebase loading in
> `js/firebase-loader.js`.

The target is still the Kindle/e-ink class: Chromium 75, jitless V8, 800×906 CSS px,
cached assets, and no animations.

## What already changed (context for the list)

- Labelled Featured shelf, consistent section markers, 44px app icons with two-line
  labels, and a full-height Dashboard tab (calendar + agenda side by side).
- The dashboard now uses `weather.cond.*`, `weather.status.error`,
  `calendar.msg.empty`, and a language-aware date, month/weekday headers and
  weather-hour labels instead of hardcoded English.
- Guest Mode has a pixel silhouette instead of a blank canvas.

## Implementation summary (2026-11-24)

| Area | What shipped |
| :--- | :--- |
| Boot | `js/firebase-loader.js` + `js/home.js`: shell/grid first; Firebase only for a stored session or login intent. A guest loads **0 Firebase bytes**; a returning user loads app+auth in idle, then Firestore+RTDB after auth. `counter.dev` is `async`. |
| Code split | Inline CSS → `css/home.css?v=4`, inline logic → `js/home.js?v=8`; five boot dependencies are generated into `js/home-deps.js?v=1` (`npm run build:home-deps`, guarded by `test-home-bundle.js`). |
| Presence | Removed `window.rekindlePresence = true`; the dashboard no longer opens a presence listener/write. |
| Weather | 15-minute `localStorage` snapshot (stale-while-revalidate), 8 s abort, feels-like/rain/wind/sunrise/sunset, updated-age label. |
| Agenda | In-memory month cache, one Google/CalDAV fetch per month (2-day edge margin), bounded Firestore range query instead of the whole collection; loading/empty/session-expired states. |
| Home shelves | One "For You" shelf with Featured/Recent/Favorites tabs (cards for Featured, icon grid for the others); All Applications is no longer pushed below three stacked sections. |
| Navigation | Last tab and per-tab scroll restored from `sessionStorage`; widget/tile deep links; Today and New event on the calendar; `?q=` opens search. |
| Search | Apps + Settings/Help/Membership/Login/Dashboard actions; matched label text highlighted; 60-result cap. |
| i18n | Date/month/weekday/hour labels follow the app language; weather conditions + new dashboard labels use locale keys (English fallback where a locale has not translated the new keys). |
| Clocks | Default world clocks derive from the saved location; the decoded list is cached; dashboard and top-bar intervals stop while hidden/off-tab. |
| A11y | ARIA tabs/labels, focus outlines, keyboard calendar days, 44px folder tabs, expanded hit areas on 30px header controls. |
| Grid | Rendered app tiles are cached (LRU 4) and re-appended on tab switches instead of rebuilding ~100 nodes. |
| Prefetch | `warmRecentApp()` skips hidden tabs and keeps the `saveData` guard; only the exact `.html` href is warmed. |

Verified with `test-i18n`, `test-locales`, `test-compat`, `test-load-budget`,
`test-home-bundle`, `test-seo`, `test-kindle`, plus 800×1000 light/dark and 600×800
screenshots, the login modal, the guest Live Games gate, the For You tabs, edit mode,
the calendar `?date=…&new=1` link, and a seeded weather/agenda cache.

**Deliberate compromises:** the new dashboard strings (12 keys: Dashboard, Actions,
New event, All Day, Feels, Sunrise, Sunset, Updated, the live-games sign-in prompt and
H/L) exist only in `en.json` today, so other languages fall back to English until the
next translation batch; folder tabs are 44px (header buttons use ~46px expanded hit
areas) rather than a literal 48px; the agenda month cache is memory-only because it
contains private event titles; and `js/home-deps.js` duplicates the five shared scripts
for the homepage in exchange for fewer requests.

---

## P1 — user-visible wins

### 1. Render the app grid before Firebase (the blank-home problem)

**Evidence.** `window.onload` (`index.html:2055`) does all of the initialisation, and
`filterApps('all', …)` is called from inside it (`index.html:2153`). The five Firebase
SDK scripts are `defer` (`index.html:75-79`), and `counter.dev` is also `defer` at the
end of the body (`index.html:4179`). Deferred scripts execute before `DOMContentLoaded`
and `onload` waits for every one of them, so on a cold/slow connection the home screen
shows its menu bar and tabs over an **empty content area** until ~176 KB of Firebase
(compressed) and the analytics request finish. The HTML app grid is empty
(`<div class="grid-container" id="app-grid"></div>`), so there is nothing to look at
while that happens.

**Proposed.** Split boot into two phases:

1. Parse/render shell: `theme.js`, `icons.js`, `js/i18n.js`, `js/ui-kit.js` + the
   `APPS` grid. Call `renderAppGrid('all')` as soon as `APPS` exists (a small inline
   script after `icons.js`, or `DOMContentLoaded` once Firebase is no longer defer).
2. Enhance: load Firebase `async`, then attach auth, Pro, favorites, live badges and
   the settings sync. Re-render only the parts that depend on them.

`counter.dev` should be `async` and must never sit between the user and the grid.

**Acceptance.** At 800×1000 on a throttled profile the first ~30 tiles are painted
before the Firebase requests start; guest first paint is not blocked by auth.

### 2. Load Firebase services on demand

**Evidence.** `index.html` loads app + auth + firestore + database + functions on every
visit. Compressed SDK sizes (from `docs/agent/performance.md`): app 5.7 KB, auth
35.5 KB, Firestore **84.2 KB**, RTDB **47.9 KB**, functions 3.2 KB.

What the page actually uses:

| Service | Used by | Needed for a browsing guest? |
| :--- | :--- | :--- |
| Auth | login/register, signed-in state | only when they tap Log In |
| Firestore | favorites, `settings/general`, user doc, dashboard agenda | no |
| RTDB | matchmaking badge, live-game validation, `serverTimeOffset`, `user_cards` avatar | no |
| Functions | `registerUser` only (`index.html:3549`) | no |

**Proposed.** Keep the login path working with app+auth; inject Firestore after an
account exists; inject RTDB only when the Multiplayer tab is opened or the badge
listener is about to attach; drop the Functions SDK from the homepage and load it in
`doRegister`. A guest who never signs in should download none of the 135 KB that
Firestore + RTDB + Functions cost. A signed-in user should not pay for them until the
data they serve is actually requested.

**Risks.** `firebase.initializeApp` is currently done in one `try` block; the lazy
loaders need to queue callbacks, and `monitorUserProfile` / `syncWithFirebaseClock`
must tolerate a missing SDK. The top-bar clock uses the RTDB server offset, so a
guest with no RTDB connection would fall back to the device clock (Kindles can be
minutes or hours off). Either accept that for guests, keep a one-shot offset request,
or add a tiny no-store `/api/time` endpoint rather than loading the 48 KB RTDB SDK just
for skew. Guard with `test-load-budget` and a runtime probe.

### 3. Remove the dead `presence/` write

**Evidence.** `window.rekindlePresence = true` (`index.html:67`) makes `theme.js`
open an RTDB listener and write `presence/{uid}` for every homepage visit
(`theme.js:740-760`). A repo-wide search finds **no reader** of `presence/` outside
that writer and comments; the live-game validator now reads
`games/{gameType}/{matchId}` instead (AGENTS.md §11). The 2026-07 code already replaced
the presence check with the game-node check.

**Proposed.** Delete the flag and the now-dead `presence/` block (or gate it behind a
feature flag if an external consumer is expected). Keep the RTDB rules for
compatibility. This removes one realtime connection and one write per homepage visit,
which also removes a source of "online" state that no longer means anything.

**Verify first.** `scripts/test-account-deletion.js` still lists `presence/uid123` in
its sweep; update the test to reflect the deletion of the writer, not the node.

### 4. Cache weather and the agenda; stop re-reading everything

**Weather.** `fetchDashboardWeather()` (`index.html:3778`) runs once per page load,
has no timeout, and shows `--°` until Open-Meteo answers. On a slow Kindle the widget
looks broken for seconds, and every homepage visit is another request.

* Store the last good payload in `localStorage` (a small, versioned object) with a
  10–15 minute TTL.
* Paint it immediately on the next load, then refresh in the background; show
  "Updated 4m ago".
* Add an 8 s `AbortController` timeout and a retry (the app already has an error
  string, `weather.status.error`).
* Do not use the service worker for this; the payload is user-location-specific and
  small enough for `localStorage`.

**Agenda.** Two separate costs:

* Local/cloud fallback: `db.collection('users').doc(uid).collection('events').get()`
  (`index.html:4076`) reads the **whole** events collection, then filters client-side
  for one day. It runs on every day tap (`selectDashboardCalendarDay` →
  `fetchDashboardAgenda`). As the calendar grows this is an unbounded read on a
  jitless device.
* Google: `fetchDashboardAgenda()` re-requests a 3-day window for every selected
  calendar on every day tap (`index.html:3992`), with pagination.

**Proposed.** Fetch a month at a time and cache it by `YYYY-MM` (session or
`localStorage`, small TTL); filter locally for the selected day. For Firestore, use a
range query on the stored start field (add the index if it does not exist) or read the
month once and reuse it. Add a "refresh" path for the current day only.

### 5. Consolidate the three home shelves

**Evidence.** A signed-in user with five favorites and a couple of recents gets
Featured (6 cards), Recent and Favorites stacked before All Applications. At 800×1000
that pushes All Applications almost entirely below the fold (reproduced with seeded
`rekindle_favorites`/`rekindle_recent_apps`). The three sections solve overlapping
jobs: "what ReKindle suggests", "what I used", "what I pinned".

**Proposed.** One "For you" shelf with three small segmented states
(Featured / Recent / Favorites) or, simpler, collapse Featured to a single row when
Recent or Favorites is non-empty. Keep the section marker language; a single shelf
should not grow when more data arrives. This also gives the app grid the first screen
back.

---

## P2 — polish and correctness

1. **Remember the tab and scroll position.** `currentFilter` always starts at `all`
   and the grid scrolls back to the top after every app launch. Store the last tab and
   `app-view.scrollTop` in `sessionStorage` (or a `#games` hash) and restore on load.
2. **Finish the dashboard i18n sweep.** Weather now localises, but these are still
   English: `H:`/`L:` (`index.html:3843`), `"All Day"` (`index.html:4109`),
   `"Session expired. Please open the Calendar app to reconnect."`, the agenda
   `"Loading..."` (use `common.loading`), and the default world-clock city names.
   Month names, weekday headers and the long date/hour labels are now language-aware.
   There are 40 locale files; add the new keys through `translate:locales` rather than
   hand-editing. Related shared bug: `time.js` `getUserLocale()` builds
   `${language}-${country}` (e.g. `fr-AU`); WebKit falls back to the device locale for
   unsupported tags, so a French user in Australia gets English dates on every page that
   uses `rekindleFormatWallDate()`. Prefer the language tag for formatting, or check the
   tag is supported before combining it with the country.
3. **Default world clocks.** With no `rekindle_clocks`, the widget shows New York,
   London and Tokyo (`index.html:3688-3711`). Derive the first clock from
   `rekindle_location_manual` and leave one or two configurable slots, or show a small
   "Add a city" empty state. Also cache the decoded clock list instead of XOR-decoding
   it every minute.
4. **Calendar actions.** A day cell only selects. Add "New event" for the selected day
   (deep-link into `calendar.html` with the date) and a "Today" reset. This turns the
   widget from a read-only month into a planner.
5. **Quick actions on the Dashboard.** A compact row under the widgets (New Note,
   Timer, Add Event, Search) gives the glance screen one-tap destinations and uses the
   space that is otherwise below the calendar on short screens. Use existing app routes
   and keys where possible; do not add another upsell.
6. **Make the widgets deep-link.** The clock, weather and calendar widgets should open
   `clock.html`, `weather.html` and `calendar.html` (with the selected date) on tap.
   Currently only the calendar's day cells are interactive.
7. **Weather depth.** The Open-Meteo response already contains apparent temperature,
   precipitation probability, wind and sunrise/sunset. Show "Feels like", the next
   hour's rain chance and wind instead of only temperature + icons.
8. **Search as a command palette.** The magnifier only filters `APPS`. Extend it to
   Settings, Help, Membership and actions ("New note", "Timer", "Live games"),
   highlight the matched substring, and cap the rendered results (the debounce exists
   because 125 rebuilt nodes are slow).
9. **Accessibility.** The icon-only Home/Dashboard tabs have no accessible name; add
   `aria-label` (keys exist: `home.nav.all_apps`, plus one new Dashboard key). Add a
   visible `:focus` outline (Chromium 75 has no `:focus-visible`), keyboard support for
   calendar day cells, and review the 30–38px action/tab heights against the 48px
   e-ink target.
10. **Offline and stale data.** The dashboard has no "last updated" state. Once weather
   and agenda are cached, show a one-line timestamp; never replace good data with
   "Unavailable" on a transient failure.

---

## P3 — engine / asset optimisations

1. **Cache the rendered grid.** `renderAppGrid()` rebuilds up to ~125 tile nodes on
   every tab switch, every edit toggle and every Pro/favorites change. Cache one
   `DocumentFragment`/node list per category and toggle visibility, or use event
   delegation so the tiles are built once. The 220 ms search debounce is a workaround
   for this cost; fixing the cost is better.
2. **Stop the dashboard clock when the tab is closed.** `loadDashboard()` starts a
   60-second interval and only clears it on `visibilitychange`
   (`index.html:4130-4147`). After the first Dashboard visit it keeps rebuilding the
   world-clock HTML every minute on every tab. Clear it in `filterApps` when leaving
   Dashboard (and reset `dashboardLoaded` or restart on return). The top-bar clock has
   the same "runs while hidden" issue; gate it too.
3. **Split the inline CSS/JS into versioned assets.** `index.html` is ~180 KB raw /
   ~38 KB gzip; most of it is an inline `<style>` block and a ~100 KB inline IIFE.
   Extracting `css/home.css` and `js/home.js` at `?v=N` lets the service worker and
   `_headers` keep them for a year, so HTML responses get much smaller. The HTML SWR
   layer already reuses the body on a 304; the win is mainly cold/updated loads, and
   the split must be done carefully because the inline block owns the `currentUser`
   closure and exposes functions to inline `onclick` handlers.
4. **Bundle the local dashboard dependencies.** `time.js` (61 KB), `theme.js` (44 KB),
   `icons.js` (78 KB), `js/i18n.js` (24 KB), `js/ui-kit.js`, `js/ip-ban.js` are six
   requests before the grid exists. A build-time `home-deps.js` (or a single minified
   bundle) would reduce request overhead on the Kindle browser and remove ordering
   errors. Bump the URL on every build.
5. **`counter.dev` must not gate init.** Move it to `async` or load it after the first
   paint. This is one line but it removes a third-party host from the critical path.
6. **`warmRecentApp()` review.** It prefetches `id + '.html'` on idle, which matches
   the tile hrefs (`notes.html`), and it honours `navigator.connection.saveData`. Keep
   it, but measure whether the Kindle browser actually reuses that entry for the
   navigation; if not, drop the request. Do not prefetch more than one app.

---

## Suggested order and acceptance metrics

1. App grid before Firebase + `counter.dev` async (largest perceived improvement).
2. On-demand Firestore/RTDB + remove the presence write (largest byte/runtime saving).
3. Weather/agenda caching and bounded reads (largest network/quota saving).
4. Shelf consolidation + tab persistence (largest layout/UX improvement).
5. i18n/a11y sweep.
6. Grid DOM cache, clock cleanup, asset split.

Measured after implementation (`gzip -c`, `test-load-budget`, runtime probes):

| Metric | Before | Result |
| :--- | :--- | :--- |
| Guest cold homepage: compressed Firebase bytes | ~176 KB | **0** (`typeof firebase === "undefined"` after load) |
| Time to first app tile | after 5 deferred Firebase SDKs + analytics | before any Firebase request; analytics is `async` |
| Open-Meteo requests per homepage visit | 1 | ≤1 per 15 min (localStorage snapshot) |
| Firestore `events` reads per calendar day tap | entire collection | one bounded month range (after first load) |
| Rebuilt tile nodes per tab switch | ~125 | **0** on cache hit (LRU 4) |
| `index.html` HTML | 180 KB raw / 38 KB gzip | **~7 KB gzip** / 469 lines |
| Local requests for the homepage | 15 | 9 (bundle + split assets) |

Do not add spinners, skeleton shimmer or fades; the e-ink rules still apply. A static
shell plus cached data is the e-ink loading state.
