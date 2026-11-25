# Visual Audit & No-Focus WebKit Harness

Read this before doing a repo-wide visual pass, before changing app chrome, or when a screenshot tool steals focus.

## Why this exists

The 2026-10-20 audit found the apps were mostly consistent, but a handful of shared
surfaces looked broken: the ReKindle+ paywall was a 98%-white full-screen wash, list
apps showed a single italic line at the top of an empty page, live lobby menus used
3rem headings with sparse buttons, and `login.html` exposed its raw diagnostics log.
This doc records the audit method and the reusable fixes.

## No-focus screenshot harness

**Never use Chromium/Playwright for these captures.** Use the system WebKit API via
the checked-in Swift helper.

```bash
python3 scripts/serve-local.py 8899          # extensionless .html fallback
scripts/shot-webkit.sh "http://127.0.0.1:8899/index.html" 800 1000 /tmp/index.png
scripts/shot-webkit.sh "http://127.0.0.1:8899/notes.html" 600 800 /tmp/notes.png \
  'var m=document.getElementById("tz-warning-overlay");if(m&&m.parentNode)m.parentNode.removeChild(m)'
```

**Viewport calibration:** use **800×1000** CSS px for the main capture. That is the
Kindle Paperwhite-class layout viewport (the 1232×1544 repo screenshots are about
1.54× of it), and `theme.js` auto-scale targets 800×906. Capturing at 600×800 makes
a 600px app window look full-width and the type look oversized; use 600×800 only as
the narrow-device check.

Why it does not steal focus:

- `TransformProcessType(..., kProcessTransformToBackgroundApplication)` before
  `NSApplication.shared`.
- The `WKWebView` is created **off-window** and snapshotted directly; there is no
  `NSWindow`, no `orderBack`, and no key/main window to activate.
- The run loop is pumped manually (`RunLoop.main.run(mode:before:)`) instead of
  `NSApp.run()`, which would activate the app.

Verified 2026-10-20 with a Finder control. Other desktop window-manager apps can
still steal focus on their own — an idle `sleep` control behaved the same way — but
the harness never asks to become frontmost. If you use `NSApp.run()`, order a
window front, or call `activate(ignoringOtherApps:)`, that guarantee is lost.

## Dark-mode captures (2026-10-26)

Dark mode needs a different capture path. WebKit's `takeSnapshot` does not
reliably composite root-filter layers for full-screen overlays or canvases that
draw after load. Use `?theme=dark` (the preview skips the service worker so a
`controllerchange` reload cannot interrupt the snapshot), and use headless
Chromium against the mapped `rekindle.ink` origin when checking dark colours on
modals, Pro gates, or canvas games. WebKit remains the layout/focus gate.
See [dark-mode.md](dark-mode.md) for the full audit and known page fixes.

## Audit workflow

1. Start `scripts/serve-local.py`.
2. Capture every root page at 800×1000 CSS px (the snapshots come out 2×).
3. Build contact sheets for triage:

   ```bash
   montage /tmp/audit/*.png -label '%t' -tile 4x3 -geometry 300x400+8+18 \
     -pointsize 16 -background white /tmp/sheet-0.png
   ```

4. Re-check any changed page at 600×800 and with `?lang=de` (longer strings).
5. A page passes when it has: System 7 window + striped title bar, one clear primary
   action, 48px controls, a real empty state (not a floating line), no overflow or
   clipping, and no all-white overlay.

## System 7 visual checklist

| Element | Standard |
| :--- | :--- |
| Window | `95%` wide, `max-width:600px`, `height:90vh`, 2px border, 4px hard shadow |
| Title bar | 35px, stripes, bold centered text, 18px close-box, right actions |
| Content | `flex:1; min-height:0; overflow-y:auto; padding:16px 18px 24px` |
| Type | Geneva/Verdana; 1.1–1.4rem headings; 0.85rem secondary; no giant headings |
| Controls | 48px min height, 2px border, 2px shadow, active invert |
| Empty state | Centered icon + bold message + optional hint/action; max-width 300px |
| Overlay | Dim `rgba(0,0,0,0.45)` backdrop + white bordered card; not a white wash |
| Dialog | `rk-dialog` striped title bar (wraps long titles), `.rk-dialog-body`, 48px actions |
| Succinct | One primary action; no duplicate titles; no gradients/animations/emojis |

## Shared fixes from the 2026-10-20 pass

- `pro-gate.js` — System 7 paywall card (14 Pro apps). Keep `display:flex` and the
  inline `zIndex = '2147483647'`; the anti-tamper interval checks both.
- `js/ui-kit.js` — `rekindleEmptyState(message, opts)` with a small SVG icon set and
  scoped `.rk-empty` styles; used by list/calendar/reader empty states.
- `login.html` — diagnostics log moved behind a closed `<details>` disclosure.
- Live lobby menus (`live*.html`) — compact `.lobby-menu` card, 48px actions.
- `words.html` / `suggestions.html` — dim scrim + white `.modal-inner` card instead
  of a white 95% wash.
- `chess`, `checkers`, `2pchess`, `2pcheckers` — modal backdrops changed from a
  white 90% wash to a dim scrim so the board stays visible.
- `neighbourhood.html` / `topics.html` — login overlays use a dim scrim + white
  `.modal-box` and app-specific copy instead of the Suggestions strings.

## Shared fixes from the 2026-10-21 pass

- **`js/system-dialog.css`** — one shared System 7 dialog card: striped title bar
  (34px min-height; long titles wrap rather than clip), `.rk-dialog-body` with
  48px full-width actions. Load it **after** the page's `<style>` block, add
  `class="rk-dialog"` to the modal box, then replace the old heading with
  `.rk-dialog-bar` / `.rk-dialog-title` and wrap the content in
  `.rk-dialog-body`. Keep the existing `#id` wrappers and JS (the `showAlert()`
  functions still write to `#custom-alert-title` / `#custom-alert-msg`).
- **Dialogs upgraded** — all eight live-game alert/winner dialogs, Pictionary's
  alert, `suggestions.html`, `words.html`, `topics.html` and `neighbourhood.html`
  sign-in gates, and Circle's start/result/leaderboard dialogs. The previous plain
  white box looked like an unfinished form next to the striped paywall card.
- **Empty states** — `contacts` (list + details pane), `flashcards`, `streak`,
  `interactive`, `reader`, `browser`, `books`, `neighbourhood` and `kindlechat`
  now use `rekindleEmptyState()` instead of a floating italic line. New icons:
  `contacts`, `cards`, `chat`, `habit`.
- **`flashcards.html` shell** — `.window-content` now flexes (`flex:1; min-height:0`)
  and `#deck-list` fills it, so the status bar sits at the bottom instead of
  mid-window with a white void underneath.
- **`akinator.html`** — start screen is vertically centred and has a simple lamp
  SVG; the old layout left most of the page blank.
- **`codebreaker.html` / `nonograms.html`** — 3rem logo headings reduced to 2rem,
  grey menu-button shadows replaced with the standard black 2px shadow, menu
  background white.
- `js/ui-kit.js` is now `?v=2` on every page that loads it. `js/system-dialog.css`
  is new at `?v=2`.

## Audit snapshot (2026-10-20)

- 136 root pages captured (excludes `index_old.html`, `admin/`, `Sync/`).
- 43 upgraded: 14 paywall, 12 empty/auth, 8 live lobbies, 4 board-game scrims,
  2 login overlays, 2 social login overlays, 1 login page.
- 93 passed unchanged.
- Deferred deliberately: `dino` (fixed 600×150 canvas), `pool`/`pool2p` (black felt
  is the game surface), `spellbound`/`strands` (gray is a modal/tab state), and
  compact game windows (`2048`, `hanoi`, `pet`, `solitaire`, `texasholdem`).

### 2026-10-21 follow-up

Re-captured all 136 root pages at 800×1000 and triaged the remaining outliers.
24 pages changed: 13 auth/alert dialogs (8 live games, Suggestions, Words, Circle,
Topics, Neighbourhood), 9 empty states (Contacts, Flashcards, Habit Tracker,
Interactive Reader, Reader, Browser, Books, Neighbourhood, KindleChat), 3 menus
(Akinator, Codebreaker, Nonograms), plus the Flashcards shell fix.
`js/system-dialog.css` is the reusable piece; future modal work should use it
instead of copying a white `.modal-box` heading.

## 2026-10-21 experience pass (dashboard + core apps)

Full-page captures (800×1000 and 600×800) plus source review of the dashboard,
Tasks, Calendar, Books, News, and the live/multiplayer gates.

- **`index.html` app search** — a magnifier button beside Edit in the
  "All Applications" header toggles a 48px full-width System 7 field (it is not
  persistent). Filters `APPS` by name, `desc`, `id` and localized names
  (multi-word AND); games are grouped by name so "chess" shows one Chess folder
  instead of four tiles. 220ms debounce, exact/prefix matches first, result
  count in the heading. No results renders `rekindleEmptyState()` with a Close
  action; X, Escape or toggling the button closes the field. Tab switches and
  Edit close it; the magnifier hides in edit mode. New `home.search.*` keys in
  all ten locales.
- **`index.html` Recent row** — last six launches in `rekindle_recent_apps`
  (localStorage), rendered between Featured and "All Applications" with a Clear
  action. Featured apps are excluded while the Featured section is enabled;
  turning Featured off makes them eligible for Recent (and they are then
  removed from All as recent), while turning it back on hides them from Recent
  again. Any app currently in Recent is removed from the All Applications grid
  (exact ids, before game folder grouping). Clearing recents re-renders All so
  those apps return. Edit mode adds a "Recent: ON/OFF"
  button next to Featured; the choice persists in `rekindle_recent_hidden`,
  hiding the row also returns its apps to All, and Reset restores it. Folders,
  disabled apps and Pro-locked tiles do not record; hidden apps are filtered;
  the row is hidden in edit mode, dashboard tab and search results.
- **Dashboard action buttons** — Edit, Recent Clear, Featured, Recent and Reset
  use the shared 30px `.sys-btn.home-action-btn` height, matching the magnifier
  button instead of the larger default `.sys-btn` padding.
- **Dashboard labels** — `renderAppGrid`/`filterApps`/`toggleEditMode` now use
  `window.t()` instead of hardcoded English, and a `rekindle:i18n:ready`
  listener refreshes the few JS-written labels so a late locale fetch cannot
  leave English headings.
- **Top-bar clock** — removed the `HEAD` request `Date`-header sync. A
  service-worker/edge-cached HTML response made that offset hours stale, so the
  menu clock disagreed with the Local Time widget by +2h. The bar now follows
  `rtdb.ref('.info/serverTimeOffset')` (same guidance as AGENTS §9).
- **Calendar + Tasks auth overlays** — white 95% washes replaced with a dim
  scrim and a bordered card, plus a "Use local calendar/tasks" escape hatch so
  an expired Google token cannot make the local apps unreachable. The
  first-run sync choosers now use a dim scrim too.
- **Books** — the two identical "No books here." blocks are now one guided
  empty state with a "Browse Reader" action; section headings return when a
  book is added.
- **News** — the bare "Could not fetch the news" line is now an empty state
  with a Retry button that re-fetches the current category.
- `index.html` and `newspaper.html` now load `js/ui-kit.js?v=2`;
  `index_old.html` (Lite/Legacy dashboard) still lacks search/recents (BL-25).

## 2026-11-24 dashboard polish (`index.html`)

A look-and-feel pass on the home screen and its Dashboard tab, captured at 800×1000
(light, dark, `?lang=de`), 600×800, 400×700, in edit mode and scrolled to the game grid.

- **Folder tabs** — originally restyled (black Games group removed, taller tabs). This
  was **reverted on 2026-11-24 at the user's request**: the original 6px/15px padding,
  4px radius, grey/black Games group and inset active highlight are back. ARIA roles,
  keyboard activation and the focus outline are retained (accessibility, not styling).
- **Featured** — the outer box now has a real `.featured-box-header` ("Featured" +
  square marker) and the grid has its own 14px padding. Cards get 44px icons, a
  two-line description, a right-hand chevron affordance and room for the PLUS badge.
- **Section headings** — All Applications, Recent, Favorites and the injected All Games
  heading share an 8px black left marker (`.view-header > span:first-child`).
- **App tiles** — 44px icons in a fixed 44px wrap, 96px rows, 14px grid gap, and a
  two-line `-webkit-line-clamp` label so long names cannot push the next row around.
  Do not add `overflow:hidden` to `.app-icon`; it clips the `top:-4px` BETA/NEW/PLUS
  badges.
- **Dashboard tab layout** — the dashboard section is `display:flex` (set by
  `filterApps`) and the grid is `auto minmax(390px, 1fr)`, so the calendar widget fills
  the window instead of leaving a white void. The 390px floor keeps the calendar from
  collapsing on short screens; `app-view` then scrolls as usual.
- **Calendar** — month navigation is two real 24px buttons; the widget body is a
  2-column grid (month + agenda) that stacks at ≤520px; days are 46px flex cells;
  the agenda has its own `.dashboard-agenda-heading` and a dashed empty state using the
  existing `calendar.msg.empty` key. The previous "No events today." string was
  hardcoded English. Month and weekday labels now come from the app language
  (`toLocaleDateString` with English arrays as fallback).
- **Weather hourly** — the hour labels use the app language too, so the strip does not
  mix an English "1 am" into a French dashboard.
- **Weather** — the icon sits in a 56px bordered well, the hourly strip uses fixed
  `.db-hour` cells with dotted separators, and the condition text now uses the existing
  `weather.cond.*` keys. The error state uses `weather.status.error` instead of
  "Unavailable".
- **Local Time** — the date is formatted with the app language (`toLocaleDateString(lang)`)
  rather than hardcoded `en-US`. Do not use `time.js` `getUserLocale()` here: it appends the
  location country (`fr-AU`), and WebKit falls back to the device locale for tags it does
  not support, which printed an English date on a French dashboard.
- **Guest avatar** — `drawGuestAvatar()` draws a 16×16 pixel silhouette in Guest Mode;
  the previous blank white canvas read as an unchecked checkbox in the menu bar.

Verification: light/dark/`de` at 800×1000, 600×800, 400×700, edit mode, a dashboard →
All tab switch, and three seeded agenda events (including all-day). No horizontal
overflow and no raw locale keys. `test-i18n`, `test-locales`, `test-compat`,
`test-load-budget`, `test-seo` and `test-kindle` pass.

Known trade-off: the calendar's implicit grid rows stretch with the widget, so on very
tall desktop viewports the day cells get large. Cap the dashboard section or add a
`grid-auto-rows` maximum if that becomes a complaint; at 800×1000 the result is a
full-height wall calendar.

## 2026-11-24 dashboard functional pass

The follow-up to the polish pass implements the proposals in
[`docs/audits/dashboard-improvements-2026-11-24.md`](../audits/dashboard-improvements-2026-11-24.md).

- **Lazy boot** — `js/firebase-loader.js` loads Firebase on demand; `js/home.js` renders
  the shell/grid first. A guest with no `rekindle_uid` now loads **zero** Firebase code;
  a stored session loads app+auth in idle, then Firestore+RTDB. Login/register load
  Functions on submit. `counter.dev` is `async`.
- **One For You shelf** — Featured/Recent/Favorites are segmented tabs inside
  `#foryou-section`; Featured uses the card grid, the other tabs reuse the 44px icon
  grid. All Applications is no longer pushed down by three separate sections.
- **Search palette** — `?q=chess` (and the magnifier) searches apps plus
  Settings/Help/ReKindle+/Login/Dashboard actions, highlights matched app labels (skips
  folder pills, where a black highlight is invisible), and caps at 60 results.
- **Dashboard additions** — open-arrow links on the clock, weather and calendar widgets;
  Today and New event in the calendar footer. New event deep-links to
  `calendar.html?date=YYYY-MM-DD&new=1` (calendar.html sets the day and opens the form).
  The Notes/Timer/Calendar/Search quick-action row was **removed 2026-11-25** to free
  vertical space for the clock/weather details.
- **Data** — weather has a 15-minute `localStorage` snapshot with a stale-while-revalidate
  path, an 8 s AbortController, feels-like/rain/wind/sunrise/sunset and an updated-age
  line. The agenda caches a month in memory, queries Google/CalDAV once per month (with a
  2-day edge margin) and uses a bounded Firestore range query; it shows an updated-age
  and a translated session-expired state.
- **Grid cache** — `renderAppGrid` caches up to four rendered category node lists keyed
  by tab/edit/Pro/games/favorites/recents/date and re-appends them on tab switches.
  Watch the cache key if you add another flag that changes tile state.
- **Clocks** — dashboard and top-bar intervals stop when the tab is hidden or left;
  world clocks derive from `rekindle_location_manual` and cache the decoded list.
- **Assets** — `css/home.css?v=12`, `js/home.js?v=14` and the generated
  `js/home-deps.js?v=1` (time/icons/icons-beta/ui-kit/ip-ban) are precached in `sw.js`.
  `npm run build:home-deps` regenerates the bundle; `test-home-bundle.js` (in `npm test`)
  fails if it drifts from its sources.
- **Tabs/persistence** — the last tab and per-tab scroll positions live in
  `sessionStorage`; `restoreHomeView()` applies them after the grid exists. `initShell`
  must run after the script's `let` declarations (it uses `setTimeout(0)` for the
  deferred script) or `currentHomeShelf` is in its temporal dead zone.

Verification: 800×1000 light/dark, 600×800, en/fr, guest with `firebase === undefined`,
login modal, guest Live Games gate, For You tabs, edit mode, calendar deep link, and a
seeded weather/agenda cache. `test-i18n`, `test-locales`, `test-compat`,
`test-load-budget`, `test-home-bundle`, `test-seo` and `test-kindle` pass.

## 2026-11-24 dashboard density + header hit-area fix

Two follow-up fixes after the first dashboard pass:

- **For You tabs were unreachable.** The compact-button hit area added to
  `#app-search-toggle::after` had `position: absolute` but the button itself was
  `position: static`, so the pseudo-element resolved against the initial
  containing block and became a full-screen transparent overlay owned by the
  search button. Taps on Featured/Recent/Favorites hit that overlay, so the tabs
  did nothing and the magnifier appeared pressed. `#app-search-toggle` now has
  `position: relative`; `elementFromPoint()` at each tab centre returns that tab.
  All other `::after` hit areas already had positioned parents.
- **The dashboard now fits the viewport without page scroll.** `fitDashboard()`
  in `js/home.js` measures `#dashboard-section` after render and after the
  weather/agenda promises settle, then applies `dash-compact`, `dash-minimal`,
  `dash-tiny` or `dash-ultra` until `scrollHeight <= clientHeight`. Compact drops
  only the hourly strip and tightens the calendar, keeping world clocks and the
  weather's feels-like/rain/wind/sun readouts; minimal drops the month grid but
  keeps those readouts; tiny hides weather details/date; ultra hides the calendar.
  `primeDashboardDensity()` applies a first guess to avoid a one-frame scrollbar,
  and a 0px section height is ignored so the first paint cannot jump straight to
  ultra.
- Measured: 800×1000 full, 600×800 full, 800×600 compact, 400×700 full,
  320×568 compact, 1024×600 compact — `app-view.scrollHeight <= clientHeight`
  in every case.
- The large weather glyph is no longer boxed: `#db-weather-icon` is just a flex
  item; the border, padding and background were removed.

Verified by hit-testing every shelf tab, clicking Favorites, switching to
Recent/Featured, the search button, and screenshots at the sizes above.

## 2026-11-24 recent apps in All Applications

Recent apps were excluded from the All Applications grid to avoid repeats, which
made a launcher disappear from the main grid as soon as it had been opened once.
The All grid now **includes** every app shown in the Recent shelf. The favorite
filter still keeps ordinary favorites out of All, but a favorite that is also in
Recent is added back explicitly (`recentVisibleIds` in `buildAppGrid`). Shelf
tiles get `shelf-icon-<id>` ids so the same app can exist in the shelf and the All
grid without duplicate DOM ids.

Verified with `recent=["calculator","notes"]` and `favorites=["notes","calendar"]`:
All shows Calculator and Notes, recent shelf shows Calculator and Notes with
`shelf-icon-*` ids, and `icon-notes` occurs exactly once.

## 2026-11-24 favorites in All + For You tab persistence

- **All Applications now includes favorites.** The favorite filter is gone;
  a featured app that is also a favorite is included too (`!a.featured ||
  featuredHidden || favoriteApps.includes(a.id)`). Recent apps were already
  added back on 2026-11-24. Shelf tiles keep `shelf-icon-<id>` ids so the
  Favorites/Recent shelf and All can show the same app without duplicate ids.
- **The open For You shelf survives reloads.** `selectHomeShelf()` writes
  `rekindle_home_shelf` to `localStorage` (with a `sessionStorage` mirror for
  older sessions), and init reads it back (validated to featured/recent/
  favorites). If the saved shelf is temporarily empty while auth/Firestore data
  loads, `homeShelfFallback` restores it once its apps arrive instead of
  sticking on Featured.

Verified with `favorites=["notes","calendar","kindlechat"]` and
`recent=["calculator","notes"]`: All shows Notes, Calendar, KindleChat and
Calculator, including the featured KindleChat favorite; clicking Favorites and
Recent survives a reload with the same tab and apps active.

## 2026-11-24 dashboard title bars removed

The 8px solid black `border-left` on `.dashboard-widget-title` (Local Time,
Weather and the calendar month) made every dashboard heading look like a tab
marker. Removed it and dropped the 10px left padding so the titles align with
the widget edge. The 2px bottom rule stays. The same 8px marker on
`.view-header > span:first-child` (All Applications, Live Games and category
headings) was removed with its 10px padding; section headings now align to the
same left edge as their content.

## 2026-11-24 tab focus ring removed

The global `[tabindex]:focus` dotted outline showed around a home tab after a
tap/click, making the active tab look double-selected. `.folder-tab:focus` and
`.foryou-tab:focus` now set `outline: none`; the global focus ring stays for
other controls. The 8px left `border-left` on dashboard widget titles was also
removed (the 2px bottom rule remains).


## 2026-11-25 dashboard quick actions removed; extras prioritized

The Local Time card's Notes/Timer/Calendar/Search row was removed. In compact
density the hourly strip is the only dashboard readout that hides: world clocks,
feels-like/rain/wind/sunrise/sunset and the updated age stay visible, while the
calendar drops to 30px day cells and a 270px minimum row. Minimal hides the month
grid but keeps those same clock/weather extras. Verified no page scroll at
800x600, 400x700, 320x568 and 800x1000; 400x700 now fits the full dashboard with
the hourly strip and calendar.

## 2026-11-25 shared dialog chrome, loading skeletons and touch pass

### Dialog normalizer

`js/dialog-enhance.js` runs after the page script on the 90 pages that contain
`.modal-box`. It moves a direct `h2`/`h3`/`.modal-title` into a
`.rk-dialog-bar` and wraps the remaining children in `.rk-dialog-body`; the
heading element itself is preserved (ids, `data-i18n`, JS updates keep working).

- Skips `.rk-dialog` (already styled), `.window-style` (calendar), computed
  `display:flex` boxes (mastodon/doom/weather/bluesky) and heading-less alert
  boxes. Those remain page-local by design.
- `js/system-dialog.css` is `?v=3`; its full-width button rule is scoped to
  `.rk-dialog-body > button` so nested button rows keep their layout. The
  title rule uses `!important` to override page heading margins/borders.
- `scripts/test-dialogs.js` asserts every eligible dialog page loads both files
  and that no `<link>` sits inside a `<style>` block (the index.html
  `document.write` string trap).
- The enhancer also reuses a page's existing close button (`.modal-close` /
  `.close-box`) and moves it into the title bar as `.rk-dialog-close`, and
  honours `data-dialog-title` for heading-less dialogs (Docs, Files, RSS).
  The About dialog is explicit `rk-dialog` markup. **Only one modal still has
  no striped title bar: Files → Preview** (`files.html#preview-modal`), which
  deliberately uses a filename header row in a flex column with its own
  Close/Download actions. Do not normalise it without preserving the flex
  image area.

### Loading skeletons

`css/loading.css` provides static, non-animated placeholders. The three pages
(wordle, maps, crossword) carry a
`data-rk-boot` skeleton that the existing first render replaces. No new shared
JS. `scripts/test-load-states.js` pins the assets and the `role="status"` text.

### Touch/typography

- The ten densest pages from the 2026-11-24 audit were raised to a 0.75rem
  (12px) minimum; decorative badges are the only intended exception.
- **Reverted 2026-11-25:** the 48px custom-select/`.sys-btn`/`touch-48.css`
  inflation was too large for the owner's taste and made title-bar
  `toolbar-btn` controls overflow the 35px bar. `css/touch-48.css` was deleted
  and `css/custom-select.css` restored to its original 34px sizing. Title-bar
  buttons must fit inside the bar; do not put a global `min-height: 48px` on
  `.toolbar-btn`/`.sys-btn`.
- `scripts/test-a11y.js` now guards only the 12px text pass.

### KindleChat reply prefix

`js/reply-text.js` builds `@user ` without touching the composer. `sendMessage`
validates the outgoing text first, then inserts the prefix only after the rules
gate passes. `scripts/test-chat-reply.js` covers prefix/empty/already-prefixed
and the validation-before-insertion order.

## 2026-11-25 Tasks layout options

`tasks.html` has a **Layout** dropdown in the title bar, next to the close box:
**Columns** (the original side-by-side lists), **Stacked** (one full-width list
per row) and **Compact** (dense rows). It is a native `<select>` with
`appearance: none` and a CSS triangle, styled to the same outer height (22px)
as the title-bar **Refresh** and full-screen buttons, in an
absolutely-positioned `.layout-select-wrap` at `left: 36px` (same slot as Manga's
Back button). The native picker keeps the menu usable on Kindle without
custom-select.js.

The choice persists in `localStorage['rekindle_tasks_layout']`;
`getTasksLayout()` validates the value, `applyTasksLayout()` sets
`layout-columns` / `layout-stacked` / `layout-compact` on `#dashboard` and syncs
the select, and `onchange="setTasksLayout(this.value)"` writes the preference.
`applyTasksLayout(getTasksLayout())` runs as the inline script parses (after the
select markup) so a saved layout does not flash Columns first.

**Do not put layout controls inside `#dashboard`.** The grid is
`repeat(auto-fit, minmax(300px, 1fr))`; a full-width in-grid bar with
`grid-column: 1 / -1` occupies both tracks, so `auto-fit` never collapses the
empty second track and a lone list stops filling the window (measured 355px of
730px at 800×1000). Title-bar placement also survives Google mode's first-load
clear of `#dashboard`, which removes every child except `#native-col`.

Stacked and compact set `.task-list { max-height: none }` so the lists flow into
the one outer `.window-content` scroller instead of adding nested scroll areas.
Verified at 800×1000, 600×800 and 400×700 in all three modes: the dropdown
matches the Refresh button height (22px), changing it re-renders, and a reload
restores `saved=compact` / `select.value=compact`.
