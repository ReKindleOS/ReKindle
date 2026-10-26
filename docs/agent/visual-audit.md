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
