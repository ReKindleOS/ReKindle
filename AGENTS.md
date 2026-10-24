# Kindle Browser Compatibility Guide

**CRITICAL:** When developing for this project, you must adhere to the following constraints to ensure compatibility with Kindle and E-ink browsers.

## 📝 Agent Documentation Rule

**This file is a living document with a 65,536-byte budget.** DSH injects it as workspace instructions on every turn; past the cap it is silently truncated (at 100 KB, the last third - the KindleChat, games and performance sections - was missing from the agent's context). So this file now holds only **cross-cutting** constraints, and area-specific deep dives live in `docs/agent/*.md`, loaded on demand.

**Where a new finding goes:**

| Finding | Destination |
| :--- | :--- |
| Applies to every page: browser limits, System 7 UI, i18n, Firebase/rules, social content rules, perf patterns | this file, in the matching section |
| Specific to one area: KindleChat internals, one game, one integration, reports, avatars, the perf audit | the matching doc in `docs/agent/` (index below) |

**Rules:**
1. **Read the area's topic doc before editing that area.** It is *not* in context automatically.
2. Document immediately after a fix: date, file paths, code, and the symptom it prevents. A few minutes of documentation now saves hours of re-discovery later.
3. **Keep this file under 60,000 bytes** (`wc -c AGENTS.md`). If an addition would push it over, move an existing deep dive into its topic doc instead of trimming the new finding.
4. Add any new topic doc to the index below and link it back to this file.

## 🗂 Topic Docs (load on demand)

Only this file is injected automatically. The docs below are **not** in the agent's context until opened - read the matching one before starting work in that area.

| Doc | Read before working on |
| :--- | :--- |
| [kindlechat.md](docs/agent/kindlechat.md) | `kindlechat.html`, `emojis.js`, `sw.js` + OpenMoji caching |
| [games.md](docs/agent/games.md) | Any game page, `js/gamerules.js`, canvas sizing |
| [performance.md](docs/agent/performance.md) | Slow-device / e-ink optimisation: containment, dirty-flag rendering, feed pagination, rect caching, denormalised comment counts (`neighbourhood_posts`/`topics` `commentCount`) |
| [moderation-reports.md](docs/agent/moderation-reports.md) | `js/reports.js`, report buttons, `/reports` data model, Discord notifications |
| [integrations.md](docs/agent/integrations.md) | Akinator, NRL scores, comics / Internet Archive, Gutenberg / Standard Ebooks (Reader tabs) |
| [avatars.md](docs/agent/avatars.md) | `drawAvatar()`, `user_cards`, pixel-art avatars, grayscale values, ReKindle+ gradient gate |
| [visual-audit.md](docs/agent/visual-audit.md) | No-focus WebKit screenshot harness, visual review, System 7 checklist |
| [backlog.md](docs/agent/backlog.md) | Deferred 2026-10 audit work: skipped/partial fixes and verification steps |
| [account-deletion.md](docs/agent/account-deletion.md) | `settings.html` Delete Account, `deleteAccount` function, full user-data sweep |
| [help.md](docs/agent/help.md) | `help.html`, `help-data.js`: adding/renaming app guides, search, A-Z index, help content coverage |
| [social-cleanup.md](docs/agent/social-cleanup.md) | Daily `cleanupSocial` retention: KindleChat messages/translations/art, topics, neighbourhood posts, reports, automod & moderator logs |
| [legacy-build.md](docs/agent/legacy-build.md) | Lite/Legacy pipeline: SRI on localized libs, extensionless links, Kobo/WebKit `/probe`, old-browser polyfills |
| [kindle-fullscreen.md](docs/agent/kindle-fullscreen.md) | `kindle/` launcher, cover, KPM |

## 🚫 Restrictions (Target: Chromium 75)

### 1. No Flexbox Gap (`gap`)
**Constraint:** Chromium 75 supports `gap` for **CSS Grid** but **NOT for Flexbox** (added in Chrome 84).
**Solution:**
*   **Flex Containers:** Use **Margins** (`margin-left` / `margin-top` on siblings).
*   **Grid Containers:** You **CAN** use `gap`. Prefer CSS Grid for layouts requiring gutters.

**Example (Correct):**
```css
/* OK in Grid */
.grid-box { display: grid; gap: 10px; }

/* BROKEN in Flex (Do NOT use) */
.flex-box { display: flex; gap: 10px; }
```

### 2. JavaScript Limits (ES2019 Ceiling)
**Constraint:** The browser supports up to **ES2019**.
**BANNED Syntax (ES2020+):**
*   ❌ Optional Chaining (`?.`) -> `user?.name` will **CRASH** the app.
*   ❌ Nullish Coalescing (`??`) -> `val ?? default` will **CRASH** the app.
*   ✅ `async`/`await`, `Promises`, `Arrow Functions` are **SAFE**.

### 3. Typography & Emojis
1.  **System Fonts (`Arial`, `Verdana`, `Courier New`, `serif`, `sans-serif`) are required.**
2.  Do not include web fonts (e.g., `@import url('https://fonts...')`); it delays render times drastically.
3.  **NO EMOJIS**: The Kindle experimental browser does not support Unicode emojis. They will render as broken square boxes (`[]`).
    - Use System 7 retro ASCII emoticons instead: `:)`, `:D`, `T_T`, `:|`, `:(`.
    - Or use manually drawn SVGs if an icon is required.

### 4. No Animations / Transitions
**Constraint:** E-ink displays run at ~7-15fps. CSS animations cause severe ghosting and flashing.
**Solution:** **Disable all animations.**
```css
* {
    transition: none !important;
    animation: none !important;
}
```

### 5. No Alerts (`alert()`)
**Constraint:** `window.alert()`, `confirm()`, and `prompt()` are unsupported.
**Solution:** Use **Custom Modals** (HTML/CSS overlays).

**Example (Correct):**
```html
<!-- Use a custom div overlay -->
<div id="custom-alert" class="modal-overlay">
  <div class="modal-box">
    <p>Operation failed.</p>
    <button onclick="closeModal()">OK</button>
  </div>
</div>
```

## 🎨 Standard UI Patterns (System 7)

All applications must adhere to the following strict HTML/CSS patterns to maintain the "Retro OS" look.

### 1. The Environment (`body`)
The body acts as the "desktop" background. It handles the centering of the application window.
```css
body {
    background-color: #e5e5e5; /* Desktop Gray */
    font-family: "Geneva", "Verdana", sans-serif;
    image-rendering: pixelated; /* CRITICAL for crisp edges */
    margin: 0;
    height: 100vh;
    overflow: hidden; /* Prevent body scroll */
    
    /* Center the App Window */
    display: flex; 
    align-items: center; 
    justify-content: center;
}
```

### 2. The Window (`.window`)
The main container for every app.
```css
:root {
    --shadow: 4px 4px 0px #000000;
}

.window {
    background: white;
    border: 2px solid black;
    box-shadow: var(--shadow); /* Hard, non-blurred shadow */
    width: 95%;
    max-width: 600px; /* Standard Tablet Width */
    height: 90vh; /* Or fit-content */
    display: flex;
    flex-direction: column;
    position: relative;
}
```

**Content-area gotcha:** `theme.js` injects `.window { max-height: 95vh !important; }` (scaled down at higher zoom levels). Use `height: 90vh` when you want a fixed-height window with a viewport gap; if you use `min-height: 90vh` instead, the window can grow to the theme.js `max-height` and lose the gap. For content pages that should shrink to their content and only scroll when content is long, use `height: fit-content` and `flex: 0 1 auto; min-height: 0;` on the scrollable child instead of `flex-grow: 1`.

### 3. The Title Bar (`.title-bar`)
**Mandatory Structure:** The title bar uses a specific layered technique to achieve the "text on stripes" look.

**HTML:**
```html
<div class="title-bar">
    <div class="title-stripes"></div>
    <div class="close-box" onclick="window.location.href='index'">X</div>
    <span class="title-text" data-i18n="app.title">My App</span>
</div>
```

**CSS:**
```css
:root {
    --stripe-pattern: repeating-linear-gradient(0deg, transparent, transparent 2px, #000 3px, #000 4px);
}

.title-bar {
    height: 35px;
    border-bottom: 2px solid black;
    display: flex;
    align-items: center;
    justify-content: center;
    background: white;
    position: relative; /* Context for absolute children */
}

/* The Striped Background Layer */
.title-stripes {
    position: absolute;
    top: 4px; bottom: 4px; left: 4px; right: 4px;
    background-image: var(--stripe-pattern);
    z-index: 0;
}

/* The centered text with white background blocking stripes */
.title-text {
    background: white;
    padding: 0 15px;
    font-weight: bold;
    font-size: 1.1rem;
    z-index: 1; /* Sits above stripes */
    display: inline-flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
}

/* Standard Close Button */
.close-box {
    position: absolute;
    left: 10px;
    width: 18px; height: 18px;
    border: 2px solid black;
    background: white;
    z-index: 2; /* Sits above everything */
    box-shadow: 2px 2px 0 black;
    cursor: pointer;
    /* Flex center content "X" */
    display: flex; align-items: center; justify-content: center;
}
```

### 4. Interactive Elements
Buttons and inputs share a "tactile" 2px border style.

*   **Buttons:** `border: 2px solid black`, `box-shadow: 2px 2px 0 black`.
    *   *Active State:* `transform: translate(2px, 2px)`, `box-shadow: none`, `background: black`, `color: white`.
*   **Inputs:** `border: 2px solid black`, `border-radius: 0`, `font-family: inherit`.

### 5. Z-Index Layering
Strict layering constants to prevent overlap issues.

| Component | Z-Index | Notes |
| :--- | :--- | :--- |
| `title-stripes` | `0` | Background pattern |
| `title-text` | `1` | Sits above stripes |
| `close-box` | `2` | Interactive top layer |
| `modal-overlay` | `10000` | Always top-most |

**Stacking-context trap:** A modal overlay must be a direct child of `<body>` (or outside any ancestor with `position: relative` + `z-index`) to actually reach `10000`. In `index.html`, `.desktop-wrapper` has `position: relative; z-index: 1`, which creates a stacking context. An overlay inside it cannot rise above the top menu bar (`.sys-menu-bar`, `z-index: 1000`), so the dim background only covers the dashboard. If the overlay is trapped, move the modal nodes to `<body>` or remove the ancestor's `z-index`.

### 6. Injected UI from Shared Scripts
When creating modals or popups dynamically from shared JavaScript (e.g., `time.js`, `theme.js`), you should reuse the standard System 7 class names (`.window`, `.title-bar`, `.title-text`, etc.) to maintain the retro aesthetic. **However**, the 120+ HTML files in this project each have their own styles for these classes, and some add properties that are **not** part of the canonical pattern above (e.g., `index.html` adds `border: 2px solid black` to `.title-text`).

**Rule:** Always scope your injected selectors and explicitly reset any property that isn't defined in the canonical pattern:

```css
#my-modal .title-text {
    /* Canonical properties from section 3 */
    background: white;
    padding: 0 15px;
    font-weight: bold;
    font-size: 1.1rem;
    z-index: 1;
    /* Explicit resets for page-level overrides */
    border: none;
    display: inline-flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
}
```

Without these resets, host-page styles will leak into your injected modal.

### 7. Branding & Badges
Standardized "Beta" or status badges.

**Beta Badge:**
```css
.beta-badge {
    font-size: 0.6rem;
    margin-left: 5px;
    border: 1px solid black;
    padding: 1px 3px;
    font-weight: bold;
    font-family: sans-serif;
    vertical-align: text-top;
    display: inline-block;
    background: white;
    color: black;
}
```

## 🌍 Localization (i18n.js)

The project uses a custom `i18n.js` loader.

### Attributes
| Attribute | Usage |
| :--- | :--- |
| `data-i18n="key"` | Sets `innerText` |
| `data-i18n-html="key"` | Sets `innerHTML` (Careful with XSS) |
| `data-i18n-placeholder="key"` | Sets input `placeholder` |
| `data-i18n-title="key"` | Sets element `title` tooltip |
| `data-i18n-only="lang"` | Shows element **only** for specific lang code (e.g., "en") |

### Variable Interpolation

The `i18n.js` loader only does simple key lookup; it does **not** interpolate `${...}` placeholders. Use `window.tFormat(key, vars, fallback)` (added 2026-10-20) for any dynamic text:

```javascript
// key: "blackjack.label.bank" -> "Bank: ${amount}"
el.innerText = window.tFormat('blackjack.label.bank', { amount: bankroll }, 'Bank: ${amount}');
```

`tFormat` takes the English fallback as its third argument, replaces **all** occurrences of each `${name}`, and is safe before translations arrive (it falls back to the English string). Do **not** call `window.t('key', { vars })` — the second argument is the fallback string, so the object is returned unchanged.

For dynamic labels, omit `data-i18n` on the element (the loader would overwrite the value with the raw template) and render from JS. Re-render static labels on `document.addEventListener('rekindle:i18n:ready', render)`; labels refreshed every frame (e.g. Mario's HUD) need no listener. Never leave `data-i18n` on an element that you also update with `removeAttribute('data-i18n')` unless the value is rendered synchronously first.

`scripts/test-i18n.js` is the guard: it rejects `data-i18n` keys whose English value contains `${...}`, `data-i18n-args`, literal `window.t('key')` calls without a fallback, and object-argument `window.t` calls.

### Two Related i18n Display Bugs (fixed 2026-07, guarded 2026-10)

1. **Raw key shown (`blackjack.label.bank`, `hangman.status.guess`, etc.):** `window.t` is defined synchronously by `i18n.js`, but `window.rekindleTranslations` only populates after the async `fetch('locales/xx.json')` resolves. Any `window.t('some.key')` called **without a fallback** from `window.onload` (which often fires first) returns `defaultText || key` → the **raw key string**. If the code then also does `removeAttribute('data-i18n')` (a common pattern to stop the loader overwriting dynamic text), the raw key is stuck on screen permanently. **Fix:** always pass an English fallback as the second argument, or use `tFormat`. The 2026-10 codemod added fallbacks to every literal `window.t('key')` call in the repo; keep it that way.
2. **Raw `${placeholder}` shown (`MODE: ${NUM}`, `Mode: ${mode}`):** never put `data-i18n="key"` on an element whose locale value contains `${...}` placeholders — `applyTranslations()` sets `innerText` to the **uninterpolated template**. The `data-i18n-args` attribute is **not supported by `js/i18n.js`** (it does nothing). For dynamically-interpolated labels, omit `data-i18n` entirely and render with `tFormat`. Fixed in `blackjack`, `memory`, `hanoi`, `lightsout`, `codebreaker`, `mario`, `pet`, `texasholdem`, `pay`, `liveyahtzee`, and `livetictactoe`.

### Icons (SVG)
Icons are stored as raw SVG strings in `icons.js`.
*   **Size:** Designed for **32x32** pixel grid.
*   **Stroke:** `stroke-width="2"` (Standard) or `"1.5"` for detail.
*   **Style:** `fill="none"` `stroke="black"` OR `fill="black"` `stroke="none"`.

## JavaScript Global `t` Naming Conflict

Do **not** define a global `function t(key, fallback)` in page scripts. `js/i18n.js` already exposes the translation helper as `window.t`. Because a global `function t` declaration also attaches itself to `window.t`, it overwrites the i18n helper and calls itself recursively, causing a `RangeError: Maximum call stack size exceeded`.

**Example of broken code (`akinator.html` before fix):**
```javascript
function t(key, fallback) {
    if (typeof window.t === 'function') {
        return window.t(key, fallback || key); // window.t is itself, infinite loop
    }
    return fallback || key;
}
```

**Fix:** Use a different local name (e.g., `translate`) and call `window.t` inside it, or use `window.t` directly with a fallback guard.
```javascript
function translate(key, fallback) {
    if (typeof window.t === 'function') {
        return window.t(key, fallback || key);
    }
    return fallback || key;
}
```

## Cloudflare Pages Functions Routing for Subpaths

Cloudflare Pages Functions uses **file-based routing**. A function file at `functions/api/foo.js` only handles:

- `/api/foo`
- `/api/foo/`

It **does not** automatically handle subpaths like `/api/foo/bar` or `/api/foo/start`.

To handle subpaths under a function route, use a catch-all file inside a folder:

```
functions/api/foo/[[path]].js   → handles /api/foo and /api/foo/*
```

**Real bug fixed (historical):** `functions/api/akinator.js` was deployed and the root `/api/akinator` worked, but `POST /api/akinator/start` returned 405 because the subpath fell through to the static asset handler. The fix was moving the function to `functions/api/akinator/[[path]].js`. (That function no longer exists — Akinator moved to a worker, then to CORS proxies, and since 2026-10 it uses an always-on Node relay on Northflank, `akinator-service/`, because Akinator's Cloudflare blocks Cloudflare Workers by TLS fingerprint. See [integrations.md](docs/agent/integrations.md). The routing lesson still applies to any future multi-endpoint function.)

## 🏗 System Architecture

### 1. JavaScript Execution (JIT-less)
*   **Engine:** V8 (Ignition Interpreter ONLY).
*   **Flag:** `--js-flags="jitless"`.
*   **Impact:** **5x-10x slower** CPU performance than standard mobile browsers.
*   **Rule:** Avoid heavy computation, crypto, or massive data parsing on the main thread.

### 2. Localization
*   **Method:** Use `data-i18n` attributes for all text content.
*   **Library:** `js/i18n.js` handles replacement automatically.

### 3. Viewport & Rendering
*   **Meta Tag:** `user-scalable=no`.
*   **Sticky Positioning:** AVOID `position: sticky` or `fixed` header/footers. They cause "checkerboarding" artifacts during E-ink page refreshes.
*   **Touch Targets:** Minimum **48x48px**.

### 4. Storage & State
*   **Persistence:** `localStorage` is available but **volatile**.
*   **Limit:** **64MB** Global Cache Limit. If exceeded, the OS performs `rm -rf` on the entire cache directory at launch.
*   **Sync:** Rely on Firebase Firestore for critical data; do not trust `localStorage` for long-term storage.
*   **`rekindle_location_manual` must stay plain JSON (2026-10-20):** `time.js`, `theme.js`, `js/i18n.js`, `index.html`, `weather.html` and `maps.html` all read it with `JSON.parse(localStorage.getItem(...))`. `settings.html` used to store it base64-XOR'd via `setSecureItem`, so every reader threw and silently lost the timezone/DST zone, the unit preference and the auto-language country. Write it with `writeStoredLocation()`; `readStoredLocation()` migrates the old obfuscated value on first read.

### 5. Timezone & Date Quirks
*   **Constraint:** The Kindle browser (`Intl` API) often defaults to **UTC** or ignores the system timezone configuration.
*   **Impact:** `new Date().getHours()` return UTC hours, not local wall time. `toLocaleString()` often fails to apply named timezones (e.g. "Australia/Sydney").
*   **Date Formatting:** The Kindle browser does **not reliably support** `dateStyle` / `timeStyle` options in `toLocaleString()` / `Intl.DateTimeFormat`. Output may differ from desktop browsers or be ignored entirely. **Always use manual string formatting** (e.g., building `"Feb 10, 2026 at 2:42 PM"` from individual date components) instead of relying on these options.
*   **Solution:**
    *   Avoid relying on `Intl.DateTimeFormat` for timezone shifting.
    *   Use a **Manual Offset** strategy: Store a numeric offset (e.g., `+11`) and mathematically shift the timestamp before displaying.
    *   Use the `time.js` helper `rekindleGetZonedDate()` which handles this shim.
*   **Timezone Setting Modal (`time.js`):**
    *   `time.js` injects a lazy System 7 modal (`checkTimezoneOffset()`) when the user has not saved a timezone offset.
    *   It triggers **only** when local-time helpers are actually called (`rekindleGetZonedDate()`, `rekindleFormatTime()`, `getDateInZone()` without an explicit zone) — it does **not** run automatically on every page load.
    *   The modal searches the Open-Meteo geocoding API, fetches the UTC offset, saves it to `localStorage` (`rekindle_location_manual` + `rekindle_timezone_offset`), and **reloads the page** on success.
    *   It has **no dismiss button** — the user must set their timezone or leave the popup open.
    *   Its "Sign in instead" button goes to `index?login=true` (the canonical index login popup); the prompt is suppressed on that URL so it cannot cover the modal, and signing in restores the account's saved timezone. See section 12.
    *   Because this modal is injected into arbitrary host pages, it is subject to the class-name leakage warning in section 6 above.

### 6. Canvas / Touch Coordinate Bug with CSS `zoom`

**Context:** `theme.js` can apply a CSS `zoom` scale to `.window` elements via user settings (`rekindle_scale`).

**Kindle Bug:** On the Kindle experimental browser, when `zoom` is active on an ancestor, `getBoundingClientRect()` returns **pre-zoom layout coordinates** while `TouchEvent`/`MouseEvent` `clientX`/`clientY` are in **post-zoom viewport coordinates**. This causes a massive touch offset (often several centimeters) for any canvas-based drawing or click-target game.

**Solution — Exempt the Game Window from Scaling:**
Games that rely on precise canvas coordinates (drawing, drag-and-drop, grid clicks, etc.) must override the global scaling rule so the `.window` renders at `zoom: 1`, while still allowing the title-bar to scale for readability.

Add this CSS block **after** your existing `.window` / `.title-bar` rules and **before** `</style>`:

```css
/* Override global scaling - only scale title-bar */
.window {
    zoom: 1 !important;
    transform: none !important;
}

.title-bar {
    zoom: var(--rekindle-scale, 1);
}

@supports not (zoom: 1) {
    .title-bar {
        transform: scale(var(--rekindle-scale, 1));
        transform-origin: top center;
    }
}
```

**Apps already using this fix:** `pool.html`, `pool2p.html`, `circle.html`, `blockblast.html`.

### 7. Unsupported CSS: `aspect-ratio` and `min()`/`max()`/`clamp()`
**Constraint:** Chromium 75 does **not** support the `aspect-ratio` property (added Chrome 88) or CSS math functions `min()` / `max()` / `clamp()` (added Chrome 79). `calc()` **is** supported.
**Solution:** Use explicit `width`/`height` (or padding hacks) instead of `aspect-ratio`, and compute min/max sizing in JavaScript instead of `min()`/`max()`.

### 8. Firebase Architecture
The project uses **two separate Firebase projects**. You must know which one your feature targets and update the correct rules file.

#### Project 1: Primary (`rekindle-dd1fa`)
*   **Used by:** Most apps (games, tools, personal data). Any HTML file using `projectId: "rekindle-dd1fa"`.
*   **Config:** `firebase.json`
*   **Firestore Rules:** `firestore.rules` — user data, leaderboards, app-specific collections.
*   **Storage Rules:** `storage.rules` — user files and photos (Pro-only).
*   **RTDB Rules:** `rtdb-rules.json` — presence, freewrite sessions, moderator lists, pro gate.
*   **Cloud Functions:** `firebase-functions/index.js`

#### Project 2: Social (`rekindle-socials`)
*   **Used by:** Social apps — KindleChat, Neighbourhood, Topics, Flipbook, Pixel, Moderation. Any HTML file using `projectId: "rekindle-socials"`.
*   **Config:** `firebase-social.json`
*   **Firestore Rules:** `firestore-social.rules` — topics, neighbourhood posts/comments.
*   **RTDB Rules:** `rtdb-social-rules.json` — KindleChat messages, translations, server-side rate limits (`kindlechat/server_rate_limits`), and the retired `kindlechat/user_recent` duplicate cache (rules kept, but nothing reads or writes it since 2026-10-20).
*   **Cloud Functions:** Same `firebase-functions/index.js` (initialized as secondary `socialAdminApp`).

#### Rule Update Checklist
When adding a new feature that writes to Firebase, you **must** update the corresponding rules:

| If your feature writes to... | Update this file |
| :--- | :--- |
| Primary Firestore (leaderboards, user collections) | `firestore.rules` |
| Social Firestore (topics, posts, comments) | `firestore-social.rules` |
| Primary Storage (user files/photos) | `storage.rules` |
| Primary RTDB (presence, sessions) | `rtdb-rules.json` |
| Social RTDB (chat messages) | `rtdb-social-rules.json` |

Without matching rules, writes will be **silently rejected** by security rules. Always follow the existing patterns in the target file for authenticated-user-only collections.

#### Game leaderboards are server-written (do not add client writes)
`leaderboard_*` documents are written **only** by the `submitScore` Cloud Function (`firebase-functions/scores.js` + `score-config.js`). `firestore.rules` denies client create/update; the browser asks `startGameRun` for a server-timed run and then submits through `js/score-submit.js`. This exists because the old rules only checked `score is number`, so one console line (`set({score: 1e308})`) took first place on every board (the 2026-10 "IMAOKASDF" report).

When adding a game with a leaderboard: add the collection to `score-config.js`, add a read/delete-only rules block, include `<script src="js/score-submit.js" data-game="…"></script>`, and call `RekindleScores.submit(collection, payload)` instead of `db…set()`. Deploy **functions before rules**. Full guide: [games.md](docs/agent/games.md#-leaderboard-integrity-added-2026-10-20-after-the-imaokasdf-is-hacking-report).

### 9. RTDB Turn Timers and `ServerValue.TIMESTAMP` Placeholders
When building turn-based multiplayer games with RTDB, store `turnStartedAt` using `firebase.database.ServerValue.TIMESTAMP` so all clients share the same clock.

**Gotcha:** After a local write, the RTDB value listener may fire before the server resolves the timestamp. The local snapshot then contains the sentinel object `{ '.sv': 'timestamp' }` (or an estimated value), not a number. Computing `Date.now() - turnStartedAt` against this placeholder produces `NaN`, which causes `setTimeout(..., NaN)` to fire immediately or with a browser-default delay.

**Solution:** Guard timer scheduling until the timestamp is a real number:

```javascript
const turnStartedAt = gameState.turnStartedAt;
if (typeof turnStartedAt !== 'number') return; // Wait for server confirmation

const elapsed = Date.now() - turnStartedAt;
const remaining = Math.max(1000, AFK_TIMEOUT_MS - elapsed);
afkTimer = setTimeout(performAfkAction, remaining);
```

This pattern is used in `liveuno.html` for the 30-second AFK auto-skip timer.

**Clock skew:** `Date.now()` on the Kindle experimental browser can be minutes or hours off from the Firebase RTDB server clock. Always use `rtdb.ref('.info/serverTimeOffset')` to compute a client-side estimate of the server time before comparing against a `ServerValue.TIMESTAMP` value. If you set turn deadlines (e.g., `roundEndsAt`) from the client, set them with the server-time estimate so every client/host evaluates them consistently.

```javascript
let serverTimeOffset = 0;
rtdb.ref('.info/serverTimeOffset').on('value', snap => { serverTimeOffset = snap.val() || 0; });
function serverTime() { return Date.now() + serverTimeOffset; }

// Reading
const elapsed = serverTime() - gameState.turnStartedAt;

// Writing
matchRef.update({ roundEndsAt: serverTime() + 80000 });
```

### 10. Host Migration in RTDB Multiplayer Games
Do **not** remove the entire game node when the host disconnects. A brief network hiccup would destroy the match and kick every player out.

**Pattern:**
1. Set `matchmaking/{game}/{matchId}.onDisconnect().remove()` only for the public listing.
2. Do **not** set `games/{game}/{matchId}.onDisconnect().remove()`.
3. In the `matchRef.on('value')` listener, detect when `gameState.host` no longer exists in `gameState.players`. If so, promote the oldest remaining human player to host and update both the game node and the matchmaking listing:

```javascript
if (!gameState.players[gameState.host]) {
    const humans = Object.entries(gameState.players || {})
        .filter(([uid, p]) => !p.isBot)
        .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (humans.length > 0 && humans[0][0] === currentUser.uid) {
        const newHost = humans[0][0];
        matchRef.update({ host: newHost });
        rtdb.ref(`matchmaking/{game}/${matchId}`).update({
            hostUid: newHost,
            hostName: gameState.players[newHost].name
        });
    }
}
```

This keeps the game alive if the host leaves or drops, and lets remaining players finish the match. It is implemented in `liveuno.html`.

### 11. Home-Screen Live Games Validation (`index.html`)

The Live Games section and its tab badge must **never trust `presence/{hostUid}` alone** to validate a `matchmaking/{game}/{matchId}` listing. `presence/{uid}` is a **global per-user online flag** (written by `theme.js` `rekindleInitGlobalPresence`), so a stale listing stays visible whenever the user is online *anywhere* in the app. Stale listings happen in practice: `liveuno.html` `leaveMatch()` cancels the matchmaking `onDisconnect` when the host leaves a lobby with players remaining (migration then owns the listing, but migration only runs while a guest client is connected), guests who disconnect abruptly leave ghost player nodes, and crashes/races can skip the `onDisconnect().remove()`.

**Pattern (implemented 2026-07):** `validateLiveMatch(gameType, matchId, match)` in `index.html` validates each waiting listing against its actual game node `games/{gameType}/{matchId}` — a 1:1 swap for the old presence read, so Firebase call count is unchanged (one read per waiting match; badge path adds a 30s per-match cache):

| Game node state | Action |
| :--- | :--- |
| Missing (re-checked once after 3s — hosts write the listing a tick before the game node, so never delete on a single miss) | Hide + best-effort `matchmaking` remove |
| `status !== 'lobby'` (started/finished but listing never removed) | Hide + best-effort remove |
| Lobby with 0 human players (ghost players; bots excluded via `isBot` flag AND `bot_` uid prefix) | Hide + best-effort remove |
| Listed `hostUid` not in players (migration missed the listing) | Heal listing: update `hostUid`/`hostName` to `game.host` if present-human, else oldest human by `joinedAt`; show with corrected host |
| Otherwise | Show as-is |

Cleanup/heal writes are idempotent and guarded by per-session attempted-sets (`mmCleanupAttempted`, `mmHealAttempted`) so badge/listener re-fires don't repeat them. RTDB rules allow any authed user to write `matchmaking`, so client-side cleanup is permitted. Transient read errors hide the entry for that render but **never** trigger cleanup and are not cached.

**Invariants for future live games:** the game node must live at `games/{gameType}/{matchId}` with `status: 'lobby'` while joinable and a `players` map of `{name, joinedAt, isBot?}` — the validator relies on all three. If a game's flow cancels the matchmaking `onDisconnect` before the listing is removed, expect the validator to eventually delete or heal the listing instead.

### 12. Authentication Entry Points (`index.html` modal vs `login.html`)

**Users sign in only through the login popup on the index page.** The canonical login/registration UI is `#login-modal` on `index.html` (`openLogin()`, the `LOG IN / REGISTER` menu item and the mobile About-sheet button). `index?login=true` opens the modal directly, so any page that needs a "log in" affordance should either open its own modal or link to `index?login=true`.

**`login.html` is a diagnostics page, not a login page.** It exists for troubleshooting: auth state, network state, `Run Diagnostics`, the raw log, Logout. It still renders working Login/Register buttons (and its own `restoreTimezone()` for direct visits with a `return`), which makes it look canonical, but users should not be sent there to sign in — and it must not be the destination of a generic auth redirect. Nothing in the app links to it any more.

**Timezone popup routing (changed 2026-10-20):** the timezone prompt's "Sign in instead" button (`#tz-signin-btn` in `time.js`) used to send users to `login?return=…`. It now sets `window.location.href = 'index?login=true'`. Three pieces keep that flow working — do not break them independently:

1. `checkTimezoneOffset()` in `time.js` returns early when the URL has `login=true` (in addition to the existing `/login…` guard). The prompt overlay is `z-index: 99999` and the index login modal is `z-index: 10000`, so without this the prompt would cover the login modal.
2. `doLogin()` in `index.html` calls `window.rekindleRestoreTimezoneFromProfile(auth.currentUser)` after the IP-ban check passes. That helper lives in `time.js` (exported at the bottom): it reads `users/{uid}/settings/general`, copies `manualLocation` / `timezoneOffset` into `rekindle_location_manual` / `rekindle_timezone_offset`, and removes an open prompt. It is what makes the popup's "Your saved timezone will be restored" hint true, and it also works for users whose localStorage was wiped by the Kindle cache cleanup.
3. `login.html` keeps its own `restoreTimezone()` (same Firestore read) for the `return` flow on direct troubleshooting visits. Keep the two implementations in sync if the `settings/general` schema changes.

The button no longer carries a `return` param, so a user who signs in from a page that showed the prompt lands on the dashboard instead of returning to that page.

## 🛡 Social & Moderation Rules

Enforced client-side and in `workers/rekindle-moderate/worker.js` for every social app (KindleChat, Neighbourhood, Topics). Reporting UI and the `/reports` data model are in [moderation-reports.md](docs/agent/moderation-reports.md).

### 0. KindleChat Direct Messages (2026-10-20)
DMs live **only** in the social RTDB (`rekindle-socials`): `kindlechat/dm_threads`, `dm_messages`, `dm_user_threads`, `dm_prefs`, `dm_blocks`. Only ReKindle+ members may start a conversation; every first contact requires recipient acceptance; all content is written by the moderation worker (clients may write only `lastReadAt` and `allowRequests`). Messages are text-only, capped at 1,000 chars, moderated, and block/report are always available. Never re-enable the legacy Firestore `rooms` collection and never grant moderators a blanket read on `dm_messages` — reports carry a scoped context instead. Kill switch: `kindlechat/config/dm_enabled` / `dm_beta_enabled`. Full design: [kindlechat.md](docs/agent/kindlechat.md#kindlechat-direct-messages-2026-10-20).

### 1. URL / Link Blocking in Social Apps
All social apps (KindleChat, Neighbourhood, Topics) block users from posting URLs and links. This is enforced **both client-side and server-side** (moderation worker).

**Client-side helper** (add to each social app HTML):
```javascript
function containsUrl(text) {
    if (!text) return false;
    var t = String(text).toLowerCase();
    var protocolLike = /h\s*t\s*t\s*p\s*s?\s*[:/]{1,4}/.test(t);
    var wwwLike = /\bwww\./.test(t);
    var domainLike = /\b[a-z0-9-]+\s*\.\s*(com|net|org|io|co|ai|app|dev|edu|gov|mil|int|biz|info|name|pro|museum|aero|coop|jobs|mobi|travel|arpa|asia|cat|tel|xxx|post|geo|mail|onion|bit|crypto|eth|us|uk|au|ca|de|fr|jp|cn|kr|ru|br|mx|es|it|nl|se|no|fi|dk|pl|cz|at|ch|be|pt|ie|nz|za|in|sg|hk|tw|id|th|vn|ph|my|xyz|club|online|site|top|ink|cc|tv|ws|me|nu|gg|to|vc|link)\b/.test(t);
    var ipLike = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t);
    return protocolLike || wwwLike || domainLike || ipLike;
}
```

**Where to block:**
*   **KindleChat:** `sendMessage()` in `kindlechat.html` (`doSendMessage()` is the only send path; the old unmoderated `sendGeneralMessageViaWorker()` was deleted 2026-10-20)
*   **Neighbourhood:** `submitPost()` and `submitComment()` in `neighbourhood.html`
*   **Topics:** `submitTopic()` (title, subheading, poll options) and `postComment()` in `topics.html`
*   **Moderation Worker:** `workers/rekindle-moderate/worker.js` — checks for each `type` handler (`kindlechat`, `topic`, `topic_comment`, `neighbourhood_post`, `neighbourhood_comment`)

**Error message (URL):** Use `"Links and URLs are not allowed."` consistently across all apps.

### 2. Banned Competitor Mentions in Social Apps
**Any mention** of these competing services is banned from social apps (not just promos): **KindleHub** (`kindlehub`, `kindlehub.pro`, and its "khub" nickname), **Unreader** / **un-reader**, **Inkchat**. KindleHub's owner repeatedly spams promo for it, so this is enforced **client-side and server-side** (moderation worker), and existing mentions are masked for display.

**Evasion forms seen in the wild (all now caught):**
* Spelled-out dots: `kindlehubDOTpro`, `Unr3ad3r-v4yf.onrender(DOT)com`
* Cyrillic/Greek homoglyphs: `kindlеhub` (Cyrillic `е`), `httрs://kindlеhub.рro/`, `unrеаdеr`
* Leetspeak: `Unr3ad3r`, `k1ndlehub`, `1nkchat`
* Separators/spacing: `kindle.hub`, `kindle hub`, `un-reader`, `k i n d l e h u b`
* The abbreviation `khub` / `K-Hub` (**must be blocked** - it is how users are funnelled to the competitor)
* Zero-width characters between letters

**Client-side helper:** `js/promo-ban.js` (loaded by `kindlechat.html`, `neighbourhood.html`, `topics.html`). It folds homoglyphs/leetspeak/diacritics to ASCII, compacts non-alphanumerics, matches `kindlehub` / `unreader` / `inkchat` plus standalone `khub`, and maps the match back to the original characters. Exposes:
```javascript
window.rekindleContainsPromotedTerm(text)      // true -> reject the write
window.rekindleCensorPromotedTerms(text)       // masks matches with █████ for display
window.rekindleContainsPromotedUsername(name)  // substring check for usernames
window.rekindleCensorPromotedUsername(name)
```
The local `containsPromotedTerm(text)` in each social page must stay as a thin wrapper that delegates to `window.rekindleContainsPromotedTerm` (with a plain-regex fallback in case the helper fails to load). **Do not re-implement the regex locally** - the old `\b(?:unreader|un-reader|inkchat|kindlehub)\b` was trivially bypassed by `kindlеhub`, `kindle.hub` and `khub`.

**Server-side mirror:** `workers/rekindle-moderate/worker.js` `containsPromotedTerm()` carries the same folding logic (comments say KEEP IN SYNC with `js/promo-ban.js`). It is applied to every content type: `kindlechat`, `topic` (title/subheading/poll), `topic_comment`, `neighbourhood_post`, `neighbourhood_comment`.

**Where to block (client):**
* KindleChat: `sendMessage()`.
* Neighbourhood: `submitPost()`, `submitComment()`, **`editPost()`** (edits write straight to Firestore, bypassing the worker), and `saveProfile()` (all bio/profile fields).
* Topics: `submitTopic()` (title, subheading, poll question/options) and the comment send path.

**Display masking:** `censorText()` (KindleChat, messages/translations/art captions) and `censorProfileText()` (Neighbourhood profiles/posts/comments) chain `rekindleCensorPromotedTerms()` before `filterBadWords()`, and displayed usernames go through `censorUsername()` (KindleChat + Neighbourhood). Topics masks titles, subheadings, poll options and comment bodies. This is intentional: old spam must not keep advertising the competitor.

**Usernames:** banned-name usernames are rejected at registration - `login.html` / `index.html` `isForbiddenUsername()` lists `kindlehub`, `khub`, `unreader`, `inkchat`, and `registerUser` in `firebase-functions/index.js` enforces the same rule server-side (client checks are bypassable). Usernames are alphanumeric-only, so the server check is a plain lowercase substring match.

**Error message (promotion):** Use `"Promotional content is not allowed."` consistently across all apps. For profiles the inline save status uses the `neighbourhood.msg.promo` key with an English fallback.

### 3. ASCII Emoji Stripping Before Moderation
The OpenAI `omni-moderation-latest` model incorrectly flags innocent ASCII art emoticons (e.g. `¯\_(ツ)_/¯`, `( ͡° ͜ʖ ͡°)`, `(っ◕‿◕)っ`) as sexual or harassing content.

**Rule:** All ASCII emojis from `emojis.js` must be stripped from message text **before** it is sent to the OpenAI moderation API.

**Implementation:** `workers/rekindle-moderate/worker.js` maintains a hard-coded list of every `art` value from `ASCII_EMOJIS` and removes them via `stripAsciiEmojis(text)` inside `moderateContent()`. If the text is empty after stripping (emoji-only messages), moderation is skipped entirely and the message is allowed.

**If you add new emojis to `emojis.js`, you must also add their `art` strings to the `ASCII_EMOJI_ARTS` array in `worker.js`.**

### 4. Server-Side Rate Limiting & Duplicate Detection (`rekindle-moderate` Worker)

The moderation worker enforces **global, per-user token-bucket rate limits** using the social RTDB, so the limits are shared across all Cloudflare Worker isolates and cannot be bypassed by parallel requests, different regions, or extracted tokens used outside the app.

#### Rate-limit data model
*   **Bucket path:** `kindlechat/server_rate_limits/{uid}/{contentType}`
*   **Bucket shape:** `{ tokens: number, lastRefill: number, updatedAt: number }`, plus `rep: string` on the `kindlechat` bucket (the repetition-guard state — see §5; it rides on this bucket, so it costs no extra operations).
*   **Concurrency:** RTDB REST `ETag` / `If-Match` optimistic locking with retry on `412` conflicts.

#### Configured limits
| Content type | Capacity | Refill rate |
| :--- | :--- | :--- |
| `kindlechat` | 5 | 1 token / 12 s |
| `topic` | 3 | 1 token / 8 h |
| `topic_comment` | 5 | 1 token / 12 s |
| `neighbourhood_post` | 5 | 1 token / 5 min |
| `neighbourhood_comment` | 10 | 1 token / 30 s |
| `dm` | 8 | 1 token / 8 s |
| `dm_request` | 5 | 1 token / 2 h (plus a 3-pending cap) |
| `report` | 5 | 1 token / 12 min |

#### Duplicate / repetitive-content detection
*   **Chat:** handled by the repetition guard in §5 below (state rides on the rate-limit bucket; adds no Firebase operations).
*   **Topics, topic comments, neighbourhood posts/comments:** **no duplicate check** (removed 2026-10-20). The old `checkUserRecentContent()` read `kindlechat/user_recent/...`, but nothing had written that node since 2026-09-21, so the check could never match — it was one wasted RTDB read per post. It is now gone, along with `recordUserRecentContent()` / `cleanupUserRecentContent()` / `rtdbSocialPutSimple()`. Duplicate protection for those types is covered by the token-bucket limits in the table above.
*   **Do not re-add a `user_recent` check** unless you also add an awaited writer (`ctx.waitUntil()` if it runs after the response). A fire-and-forget writer is what silently killed it for a month.

#### Important rules
*   No user bypasses the limits — not even `ukiyo@rekindle.ink` or moderators.
*   These paths are **service-account writable only** in `rtdb-social-rules.json`.

#### Firebase RTDB Script Gotcha
Only include `firebase-database-compat.js` on pages that actually use Realtime Database (presence, matchmaking, chat, sessions, etc.). Pages that only need Auth/Firestore/Functions (such as `login.html`) should omit it. Loading RTDB unnecessarily can trigger `SafariExtensionMessageEvent` duplicate-variable errors in browsers with certain Safari extensions installed, and it causes extra polling connections to `*.firebaseio.com` that may log CORS/network errors even when the user is authenticated.

#### Reading Social RTDB Data from Non-Social Pages
Any page that reads/writes data owned by the **social** project (e.g. `users_public/{uid}/birthday`, written by `neighbourhood.html`) must do the full social-auth setup — referencing `socialRtdb` without it crashes with `ReferenceError` (this was the `life.html` stuck-loading bug, 2026-07):

1. Include `firebase-functions-compat.js` (needed for the callable).
2. Init the secondary app: `const socialApp = firebase.initializeApp(socialConfig, 'social'); const socialRtdb = socialApp.database(); const socialAuth = socialApp.auth();` (config in `neighbourhood.html:1151`).
3. Sign in before any RTDB access: `firebase.functions().httpsCallable('getSocialToken')({})` → `socialAuth.signInWithCustomToken(result.data.token)`. The callable (main project) mints a social custom token carrying `moderator`/`pro`/`ageVerified`/`email` claims; social RTDB rules on `users_public` require `auth.token.ageVerified == true` even for reads.
4. Non-social pages should NOT force the `ensureAgeVerified()` flow — instead degrade gracefully (e.g. `life.html` falls back to `localStorage` key `rekindle_life_birthday`) so non-age-verified users can still use the app; their data just won't sync.

### 5. Repeated-Message Flood Guard (KindleChat, 2026-10-20)

On 2026-10-19 a user flooded a dead chat for ~30 minutes with `hello hello hello`, `hi hi hi hi bhi hi`, `hhhh…eeee…llll…oooo` and `aaaa` messages. The exact-duplicate check should have stopped the repeat `hello` lines but never did: the newest `kindlechat/user_recent` entry is from **2026-09-21**, so duplicate blocking had silently been dead for a month (the record calls were fire-and-forget after the response, with no `ctx.waitUntil`).

Fix: `evaluateChatRepetition()` in `workers/rekindle-moderate/worker.js` + the client mirror `js/spam-guard.js`.

*   **Rule:** a user's 3rd near-identical message within 10 minutes is rejected (`429` with `retryAfter` and a reason string); the exact same message twice within 5 minutes is rejected. Pixel art compares the `grid_data` hash instead.
*   **Near-identical** = same *dominant* word/letter after collapsing character runs and dropping `@mentions` — `hello` ≡ `hello hello hello` ≡ `hellllooooo` ≡ `hhhh…llll…oooo` — or token-set Jaccard ≥ 0.5 (`hi hi hi` ≡ `hi hi hi bhi hi`).
*   🔴 **Zero extra Firebase cost (hard requirement — do not break this):** the state is stored in the **existing** `kindlechat/server_rate_limits/{uid}/kindlechat` bucket as a `rep` string (≤ ~350 bytes, hashes only, last 4 message shapes), which the worker already `GET`s and `PUT`s once per message. Never add a separate read/write for spam state. The change removes the 3 per-message `user_recent` ops (check GET + record PUT + cleanup GET), so chat posting is **net −3 RTDB operations**.
*   Rejected attempts are still recorded, so a spammer cannot outlast the 10-minute window by hammering send.
*   `kindlechat.html` checks `window.rekindleChatSpamCheck()` in `sendMessage()` (before `checkRules()`) and calls `window.rekindleRecordChatMessage()` after a successful post. The client copy is localStorage-only and must stay in sync with the worker (same KEEP IN SYNC convention as `js/promo-ban.js`). `doSendMessage()` shows the worker's `result.error` for `allowed: false` so the specific reason reaches the user.
*   Tests: `node scripts/test-chat-spam.js` replays the real flood transcript through the worker logic and the client mirror, and asserts normal conversation is untouched.

## 🔐 Server Boundary Rules (2026-10-20 audit)

*   **`functions/api/proxy.js` is not a general CORS proxy.** It now allows GET/HEAD only, rejects private/loopback/link-local/metadata hosts and embedded URL credentials, re-validates every redirect, forwards only `accept`/`accept-language`/`authorization`/`if-none-match`/`range`, enforces a 10 s timeout and 10 MB response cap, and sends no wildcard CORS header. Any new public API host should get a dedicated allowlisted function (see `gutenberg.js`/`reddit.js`) instead of widening the generic proxy. Do not add POST support without a concrete caller.
*   **Mail callables require auth + an active ReKindle+ subscription.** `fetchEmails`, `moveEmail`, `modifyFlags`, `fetchEmailBody`, `sendEmail`, and `getFolders` must call `assertMailAccess(request, kind)` and `assertMailEndpoint(host, port, kind)` before opening an IMAP/SMTP connection. They rate-limit via `mail_rate_limits/{uid}/{kind}` (service-account only) and return generic errors — never the raw upstream message.
*   **Custom auth claims must be merged, never replaced.** Identity Toolkit's `customAttributes` replaces the whole claims object. Use `mergeClaims()` (`workers/rekindle-stripe/claims.js`) or spread the existing claims before calling `setCustomUserClaims`; otherwise `ageVerified`/`moderator` are silently deleted when Pro is granted or revoked. `getSocialToken` lazily repairs a wiped `ageVerified` claim from `users/{uid}/ageVerification/latest`.
*   **Quality gate:** `npm test` runs the i18n, compatibility, proxy-guard, claim-merge, chat-spam, direct-message, Oregon Trail, and Pinterest cross-device connection checks. Both CI and the deploy workflow run it before building.

## 📦 Dependency & CodeQL Security (2026-10-20)

*   **`npm audit` must report 0** for the two tracked Node manifests: the repo root (build tooling + `admin/` scripts) and `firebase-functions/` (Cloud Functions). `workers/rekindle-reader` is separate and clean. Use plain `npm audit fix` (non-major only); never `npm audit fix --force`.
*   **`firebase-admin` stays on `13.10.x` on purpose.** 13.10 drops the vulnerable `node-forge` dependency and moves `@google-cloud/firestore`/`storage` to optional dependencies. v14 is **modular-only**: it deletes the namespaced `admin.auth()`, `admin.database()`, `admin.firestore()`, `admin.credential.*`, `admin.firestore.FieldValue` and `admin.database.ServerValue` APIs used throughout `firebase-functions/` and `admin/*.js`. Migrating to v14 (`getAuth()`, `getDatabase()`, `getFirestore()`, `cert()`, modular `FieldValue`/`ServerValue`) is a separate refactor, not a version bump.
*   **Keep `"uuid": "^11.1.1"` in both `overrides` blocks.** firebase-admin 13.10 still installs the optional Google Cloud clients, whose `uuid < 11.1.1` copies trigger GHSA-w5hq-g745-h8pq. Those libraries only call `uuid.v4()`, so the major override is safe; remove it when the admin v14 migration lands.
*   **Do not re-add `firebase-functions-test`** until it peer-supports `firebase-admin@14`. It is unused (no test files reference it) and pulled a vulnerable jest / `ts-deepmerge` / `js-yaml` tree that accounted for most Dependabot alerts.
*   **CodeQL default setup analyzes `actions`, `javascript-typescript` and `python` only.** `scripts/shot-webkit.swift` is a standalone macOS WebKit harness with no Xcode/SwiftPM project, so CodeQL's Swift autobuild always fails on the macOS runner. Do not re-add Swift to the default setup and do not add a `codeql.yml` (advanced setup cannot coexist with default setup).
*   **Node 22 is the build/runtime baseline.** CI and the deploy workflow run Node 22 (Node 20 is EOL and `firebase-admin@14` requires ≥22). The functions package already pins `"engines": {"node": "22"}`.
*   **Mail-library majors:** `nodemailer@10`, `imapflow@2` and `mailparser@3.10` only change packaging/Node floor (≥20) — the `createTransport`/`sendMail`, `new ImapFlow`, `fetchOne`/`search`/`list` and `simpleParser` APIs used by `firebase-functions/index.js` are unchanged.
*   **Never sanitise HTML with a regex.** Rich text from Reddit, Wiktionary, saved notes and RSS goes through `js/safe-html.js` (`window.rekindleSetSafeHtml(el, html)` / `window.rekindleSafeHtmlFragment(html)`), which parses with `DOMParser`, removes script/style/iframe/form nodes, `on*` handlers and `javascript:`/`vbscript:`/`data:` URLs, then appends inert nodes (never `innerHTML`). Values inside inline handlers use the `escapeJsString()` helper (JS escapes + HTML entities); Firebase push keys are safe as ids. Regex `<script>` stripping is what produced the 2026-10 code-scanning XSS backlog — do not reintroduce it.
*   **Code scanning is kept at 0 open alerts.** The 26 alerts dismissed on 2026-10-20 are triaged: test-only linters (`used in tests`), plain-text scrapers rendered with `textContent`/`innerText`, the DOMParser sanitiser itself, the localhost-only dev server, and two accepted `localStorage` caches (timezone city/offset and the user's own birthday — no credentials). If a new alert appears, fix the sink first; only dismiss with a specific comment.

## ✅ Best Practices
-   **Images:** Use **WebP** or **SVG**. They are fully supported and perform best.
-   **Modals:** Always stick to the `.modal-overlay` / `.modal-box` DOM structure found in `weather.html`.
-   **Custom Selects:** `js/custom-select.js` replaces native `<select>` elements with a System 7 styled widget. Because the native select is hidden, the custom widget must explicitly respect the native `disabled` state and per-option `disabled` attributes via the `disabled` CSS class and early-return guards in the `CustomSelect` class (see the `updateDisabledState()`, `toggle()`, `open()`, `select()`, and `renderOptions()` methods). Without this, a disabled select will still appear interactive. **Modal gotcha:** the replacement `.custom-select-container` is `display: inline-block; width: auto` and does NOT inherit page CSS aimed at `select` (e.g. `.modal-form select { width: 100%; margin-bottom: 20px }`), so selects inside modals render shrunken with collapsed spacing. Re-apply layout to the widget: `.modal-form .custom-select-container { display: block; width: 100%; margin-bottom: 20px; }` and `.modal-form .custom-select-trigger { width: 100%; box-sizing: border-box; }` (see `checkers.html` / `chess.html` new-game modals).
-   **Dark mode chrome:** `theme.js` applies a global `invert(1) hue-rotate(180deg)` filter in dark mode. Because `color-scheme: dark` changes the default canvas text color to white, the filter would invert that text back to black-on-black, so `theme.js` now also sets explicit `color: #000` on the dark root so the filter produces white text. White buttons, close boxes, and borders on light System 7 UI can also become black-on-black and disappear; add the `no-invert` helper class (re-inverted by `theme.js`) to any control that must stay visible in dark mode, e.g. `<div class="controls no-invert">` or `<button class="sys-btn no-invert">`. Note that `.no-invert` restores the original light colors, so text inside a `.no-invert` element with a transparent background may end up black-on-black; add a dark-mode `color: #fff` rule for that text (see `pet.html` `.btn-label`). **Note:** Dark mode is currently temporarily disabled — `theme.js` forces `light` mode and `settings.html` greys out/disables the theme dropdown.

## 🌐 External API Proxies (Rate-limiting)
External APIs such as Reddit aggressively rate-limit shared cloud egress IPs (e.g., Cloudflare Pages/Workers). Any proxy under `functions/api/` or `workers/` that calls an external API should:

- Cache successful GET responses using `caches.default` so all users share the same cached copy.
- Retry on `429 Too Many Requests` and `5xx` errors with exponential backoff, respecting any `Retry-After` header.
- Return stale cached data to the client when the upstream is rate-limiting, so the UI doesn't appear broken.
- Use different cache TTLs by content type (e.g., 60 s for RSS feeds, 5 min for images).

Example pattern: `functions/api/reddit.js`.

**Some hosts block Cloudflare egress outright — a proxy cannot fix it.** `standardebooks.org` answers every request from AS132892 (the Workers/Pages network, e.g. `2a06:98c0:3600::103`) with an Apache 403, whatever the User-Agent or headers, so `/api/proxy` and `/api/*` are dead ends for it. Relay through a Firebase function (Google Cloud egress) instead — see `firebase-functions/standardebooks.js` and [integrations.md](docs/agent/integrations.md#standard-ebooks-403s-every-cloudflare-egress-ip-2026-10-20). Same workaround family as the Akinator relay (`akinator-service/`).

## ⚠️ Deploying to Cloudflare Pages (do not deploy the repo root)

`npx wrangler pages deploy .` uploads **everything in the directory, including `.gitignore`d files**. `service-account.json`, `service-account-social.json` and `firebase-functions/.env` (which also holds `OPENAI_API_KEY`) were publicly downloadable from both `rekindle.ink` and `beta.rekindle.ink` until 2026-10-20 because the deploy scripts pointed at `.` and `build-automation.js`'s `ignoreList` did not exclude them.

**Rules:**
*   Deploy the build output, never the source tree: `npm run build && npx wrangler pages deploy _deploy/main --project-name=rekindle --branch=main` (prod) or `--branch=beta` (beta). `npm run deploy:prod` / `npm run deploy:beta` now do this.
*   `_deploy/main` must contain `functions/` — Cloudflare Pages needs it at the deploy root, and `build-automation.js` copies it in.
*   `build-automation.js` has `FORBIDDEN_IN_DEPLOY` + `assertNoSecretsInDeploy()`: the build aborts if any credential file survives the copy. Keep that list in sync with `ignoreList` when adding new secret files.
*   Pages caches non-HTML assets on the edge (`s-maxage=604800`). A file removed from a deployment can still be served from the custom-domain cache for up to 7 days — purge the cache (or rotate the credential) after any accidental publish.

### 🧊 Cache busting a changed shared asset (required)

Pages serves non-HTML assets from the edge for up to 7 days, and installed service workers keep their own copy. **A deploy that changes a shared JS/CSS file without changing its URL is only half-shipped**: the new bytes sit on the origin while users keep receiving the cached old file.

| What changed | What to do |
| :--- | :--- |
| A versioned shared script (`theme.js`, `icons.js`, `bad_words.js`, `js/gamerules.js`, `js/promo-ban.js`, …) | Bump `?v=N` **in every HTML file that includes it**, and in `sw.js` `ASSETS_TO_CACHE` if listed there. |
| A shared script with no `?v=` yet | Add `?v=1` (or `?v=2` if it already shipped unversioned) on the deploy that first changes it. |
| `sw.js` `ASSETS_TO_CACHE` / cached HTML | Normally nothing — `build-automation.js` stamps a unique `CACHE_NAME` into every deploy. Bump the source value only when serving the source tree without a build. |
| A deleted file | Nothing works except a Cloudflare cache purge — a removed URL can keep serving for 7 days. |

**Build-time SW cache stamping (2026-10-20):** `build-automation.js` rewrites
`CACHE_NAME` in each deploy target's `sw.js` to `rekindle-cache-<short SHA>-<run id>`
(a timestamp for local builds) before minification. Every GitHub Actions push
therefore ships a new service-worker cache, and the `activate` handler deletes the
previous one. Manual `CACHE_NAME` bumps are only needed for source-only/static
testing; the build output always wins.

Do **not** rely on the service worker's stale-while-revalidate branch to roll a change out: it returns the cached copy on the first load, and the background revalidation can itself be answered by the edge cache. Only a new URL is guaranteed to miss both caches.

Shared-asset URL bumps still require `_deploy/` to be rebuilt (`npm run build`) before deploying — the deploy copies `_deploy/main`, so a stale build publishes old files even when the source is current.

**2026-10-20 incident:** `theme.js` changed in `c5631c5` but every page still loaded `theme.js?v=18` (the v18 bump predated the change). Edge/SW caches kept serving the old theme.js to up to 7 days of traffic. Fixed by bumping all 137 pages to `?v=19`, `js/gamerules.js` to `?v=2` (its Oregon Trail rules text changed in `8ab5b20`), `icons.js` v2 → v3 on the three pages still on v2, and `sw.js` `CACHE_NAME` to `rekindle-cache-v25` (2026-10 re-audit also versioned the previously unversioned shared scripts).

## Local Testing Gotcha: Service Worker Forces Extensionless URLs

`theme.js` registers a service worker that reloads the page to the extensionless URL (`/jumpy.html` → `/jumpy`) on first load. `python3 -m http.server` then 404s, showing an "Error response" page with no `.title-text` — looks like a broken page, but isn't. Test locally with a static server that falls back to `.html` (try file, then file + '.html'), or use query params (`?lang=de`) which also bypass the reload. Production (Cloudflare Pages) serves extensionless URLs natively.
