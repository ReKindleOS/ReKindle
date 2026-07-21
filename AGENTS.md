# Kindle Browser Compatibility Guide

**CRITICAL:** When developing for this project, you must adhere to the following constraints to ensure compatibility with Kindle and E-ink browsers.

## 📝 Agent Documentation Rule

**This file is a living document.** Whenever you fix an issue, discover a gotcha, uncover a cross-page CSS leak, or learn anything about this codebase that isn't already written here, **add it immediately**.

Future agents (including yourself in a new session) will not have access to your working context. If you don't write it down, the knowledge is lost. Be generous with details, code snippets, and file paths. A few minutes of documentation now saves hours of re-discovery later.

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

### 4. No Alerts (`alert()`)
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

The `i18n.js` loader only does simple key lookup; **it does NOT interpolate variables**. Locale values use `${key}` placeholders (e.g. `"${pName}: Place ${ship} (${size})"`), but calling `window.t('key', { pName: ... })` will return the raw placeholder string unchanged. In dynamic code, fetch the template first and then replace placeholders manually:

```javascript
var template = window.t ? window.t('battleship.setup.msg') : '${pName}: Place ${ship} (${size})';
var text = template.replace('${pName}', 'You').replace('${ship}', shipName).replace('${size}', shipDef.size);
```

Or use a small helper that replaces all `${key}` occurrences. Many existing HTML files incorrectly pass a variables object as the second argument to `window.t()`, which silently fails on the Kindle browser.

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

**Real bug fixed:** `functions/api/akinator.js` was deployed and the root `/api/akinator` worked, but `POST /api/akinator/start` returned 405 because the subpath fell through to the static asset handler. The fix was moving the function to `functions/api/akinator/[[path]].js`.


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

### 6b. Unsupported CSS: `aspect-ratio` and `min()`/`max()`/`clamp()`
**Constraint:** Chromium 75 does **not** support the `aspect-ratio` property (added Chrome 88) or CSS math functions `min()` / `max()` / `clamp()` (added Chrome 79). `calc()` **is** supported.
**Solution:** Use explicit `width`/`height` (or padding hacks) instead of `aspect-ratio`, and compute min/max sizing in JavaScript instead of `min()`/`max()`.

### 6c. Fitting a square game canvas + controls vertically (`crossy.html`)
A canvas styled only with `width: 100%; max-width: 512px` scales with **width** only, so on short screens the canvas + on-screen controls overflow the `95vh` window — and with `body { overflow: hidden; touch-action: none; }` the window cannot be scrolled to reach the controls.

**Pattern:** Size the canvas in JS from the actual leftover vertical space, measuring the other chrome via the DOM so title-bar zoom/padding are accounted for:

```javascript
function resizeCanvas() {
    if (!canvas) return;
    var win = document.querySelector('.window');
    var content = document.querySelector('.window-content');
    var maxW = Math.min(content.clientWidth - 30, 512); // content box width, capped
    var maxWindowH = Math.floor(window.innerHeight * 0.95); // matches .window max-height
    var othersH = win.offsetHeight - canvas.offsetHeight;   // everything except the canvas
    var size = Math.floor(Math.min(maxW, maxWindowH - othersH - 8)); // -8 = canvas border
    if (size < 128) size = 128;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
}
```

Call it in init, on `resize`/`orientationchange`/`load`, and with a couple of delayed `setTimeout`s (theme.js may apply title-bar zoom after first paint, changing available height).

### 7. Firebase Architecture
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
*   **RTDB Rules:** `rtdb-social-rules.json` — KindleChat messages, translations, server-side rate limits (`kindlechat/server_rate_limits`), and per-user duplicate-detection cache (`kindlechat/user_recent`).
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

### 9. Server-Side Rate Limiting & Duplicate Detection (`rekindle-moderate` Worker)

The moderation worker enforces **global, per-user token-bucket rate limits** using the social RTDB, so the limits are shared across all Cloudflare Worker isolates and cannot be bypassed by parallel requests, different regions, or extracted tokens used outside the app.

#### Rate-limit data model
*   **Bucket path:** `kindlechat/server_rate_limits/{uid}/{contentType}`
*   **Bucket shape:** `{ tokens: number, lastRefill: number, updatedAt: number }`
*   **Concurrency:** RTDB REST `ETag` / `If-Match` optimistic locking with retry on `412` conflicts.

#### Configured limits
| Content type | Capacity | Refill rate |
| :--- | :--- | :--- |
| `kindlechat` | 5 | 1 token / 12 s |
| `topic` | 3 | 1 token / 8 h |
| `topic_comment` | 5 | 1 token / 12 s |
| `neighbourhood_post` | 5 | 1 token / 5 min |
| `neighbourhood_comment` | 10 | 1 token / 30 s |
| `report` | 5 | 1 token / 12 min |

#### Duplicate / repetitive-content detection
*   **Path:** `kindlechat/user_recent/{uid}/{contentType}/{hash}`
*   **Hash:** Normalized text (lowercased, punctuation stripped, whitespace collapsed) run through DJB2.
*   **Window:** 5 minutes.
*   Repeated identical or near-identical text within the window is rejected with a `429` error.

#### Important rules
*   No user bypasses the limits — not even `ukiyo@rekindle.ink` or moderators.
*   These paths are **service-account writable only** in `rtdb-social-rules.json`.

#### Firebase RTDB Script Gotcha
Only include `firebase-database-compat.js` on pages that actually use Realtime Database (presence, matchmaking, chat, sessions, etc.). Pages that only need Auth/Firestore/Functions (such as `login.html`) should omit it. Loading RTDB unnecessarily can trigger `SafariExtensionMessageEvent` duplicate-variable errors in browsers with certain Safari extensions installed, and it causes extra polling connections to `*.firebaseio.com` that may log CORS/network errors even when the user is authenticated.

### 8. URL / Link Blocking in Social Apps
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
*   **KindleChat:** `sendMessage()` and `sendGeneralMessageViaWorker()` in `kindlechat.html`
*   **Neighbourhood:** `submitPost()` and `submitComment()` in `neighbourhood.html`
*   **Topics:** `submitTopic()` (title, subheading, poll options) and `postComment()` in `topics.html`
*   **Moderation Worker:** `workers/rekindle-moderate/worker.js` — checks for each `type` handler (`kindlechat`, `topic`, `topic_comment`, `neighbourhood_post`, `neighbourhood_comment`)

**Error message (URL):** Use `"Links and URLs are not allowed."` consistently across all apps.

### 9. Promotional Term Blocking in Social Apps
The following competing-service names are banned from mention in social apps as promotional content: **Unreader**, **un-reader**, **Inkchat**, **kindlehub**. This is enforced **both client-side and server-side** (moderation worker).

**Client-side helper** (add to each social app HTML next to `containsUrl`):
```javascript
function containsPromotedTerm(text) {
    if (!text) return false;
    return /\b(?:unreader|un-reader|inkchat|kindlehub)\b/i.test(String(text));
}
```

**Where to block:** Same locations as URL blocking. Apply `containsPromotedTerm()` to message text, topic titles/subheadings, poll questions/options, post text, and comment text.

**Error message (promotion):** Use `"Promotional content is not allowed."` consistently across all apps.

### 10. ASCII Emoji Stripping Before Moderation
The OpenAI `omni-moderation-latest` model incorrectly flags innocent ASCII art emoticons (e.g. `¯\_(ツ)_/¯`, `( ͡° ͜ʖ ͡°)`, `(っ◕‿◕)っ`) as sexual or harassing content.

**Rule:** All ASCII emojis from `emojis.js` must be stripped from message text **before** it is sent to the OpenAI moderation API.

**Implementation:** `workers/rekindle-moderate/worker.js` maintains a hard-coded list of every `art` value from `ASCII_EMOJIS` and removes them via `stripAsciiEmojis(text)` inside `moderateContent()`. If the text is empty after stripping (emoji-only messages), moderation is skipped entirely and the message is allowed.

**If you add new emojis to `emojis.js`, you must also add their `art` strings to the `ASCII_EMOJI_ARTS` array in `worker.js`.**

### 11. RTDB Turn Timers and `ServerValue.TIMESTAMP` Placeholders
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

### 12. Host Migration in RTDB Multiplayer Games
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

### Akinator API (`akinator.html`)
The Akinator game is no longer a Pages Function. It is served by the standalone Cloudflare Worker at `workers/rekindle-akinator/` and deployed at `https://rekindle-akinator.timjarnott.workers.dev`.

Frontend uses `API_BASE = 'https://rekindle-akinator.timjarnott.workers.dev'` and calls `/start`, `/answer`, `/back`, and `/continue`.

Important notes:
- Akinator.com sits behind Cloudflare bot protection; server-side calls can be blocked if the upstream IP/headers are flagged.
- The start endpoint scrapes the Akinator `/game` page. Reliable patterns are:
  - `session: '...'` (inline JS)
  - `signature: '...'` (inline JS)
  - `<p class="question-text" id="question-label">...</p>`
  - Answer labels from `<a class="li-game" href="#" id="a_yes" onclick="chooseAnswer(0)">...</a>` (and `a_no`, `a_dont_know`, `a_probably`, `a_probaly_not`).
- Action endpoints: `/answer` (send 0-4), `/cancel_answer` (back), `/exclude` (continue after wrong guess).
- Supported regions and theme `sid` values: characters=1, objects=2, animals=14.
- Sessions are short numeric strings (e.g. `'886'`) and the signature is base64 — both appear multiple times in the `/game` HTML. `extractFirst()` picks the **longest** match across all patterns to avoid short decoys.
- `/continue` maps to Akinator `/exclude` and **must** send `forward_answer: '1'` (per the site's own `continuePartie()` JS) — **not** `step_last_proposition`. Without it, Akinator returns the HTML game page instead of JSON, and the browser's `res.json()` throws "The string did not match the expected pattern."
- The worker validates every passthrough response with `JSON.parse` and returns a 502 `{error}` if Akinator sends HTML/empty bodies, so the frontend always gets valid JSON.
- Canonical endpoint params (scraped from the `/game` page inline JS, 2026-07): `/answer` = step, progression, sid, cm, answer, step_last_proposition, session, signature. `/cancel_answer` = step, progression, sid, cm, session, signature. `/exclude` = step, sid, cm, progression, session, signature, forward_answer ('1' = keep playing, '0' = end game).
- Never write fetch URLs as `'${API_BASE}/path'` in the page script — `${...}` inside a plain string is not interpolated (that was the original "The string did not match the expected pattern" start error). Use `API_BASE + '/path'`.
- akinator.com hard-blocks some residential IPs with a Cloudflare 403 even with full browser headers; the worker's Cloudflare egress works. Don't trust local `curl` results for diagnosis — debug through the deployed worker instead.

## ❓ Game Rules Helper (js/gamerules.js)

`js/gamerules.js` adds a "?" button to the title bar of games whose rules may not be universally known, opening a System 7 "How to Play" modal.

### How it works
- Pages opt in simply by including `<script src="js/gamerules.js"></script>` (in `<head>`, next to `js/i18n.js`).
- The game is detected from the page **filename** via the `ALIASES` map (e.g. `2pchess`, `livechess` → `chess`), so variants share one rules entry.
- Rules text lives in the `RULES` registry as English default HTML. At open time it calls `window.t('gamerules.<key>', defaultHtml)`, so translations can be added to locale files later without touching this script. Title/close use `gamerules.title` / `gamerules.close`.
- The modal (`#gamerules-overlay`) is appended to `<body>` (never inside `.window`) to dodge the stacking-context trap, with all CSS scoped under `#gamerules-*` selectors and explicit resets per the injected-UI rules in section 6.

### Button placement gotcha
Several games already have right-side title-bar controls (e.g. `yahtzee.html` New/Scores buttons, `chess.html` Stats, `2048.html` Reset, `spellbound.html` Stats, `oregontrail.html` Restart). The script measures those siblings with `offsetLeft`/`offsetWidth` (**pre-zoom layout units** — safe under theme.js CSS `zoom`, unlike `getBoundingClientRect()`) and shifts the "?" button left of them. All target pages' `.title-bar` rules have `position: relative`, which this relies on.

### Adding a new game
1. Add an entry to `RULES` (key) and `ALIASES` (filename → key) in `js/gamerules.js`.
2. Include the script tag in the page's `<head>`.
3. Optionally add `gamerules.<key>` translations to the locale files.

Games deliberately **excluded** (rules universally known / self-evident): tictactoe (+2p/live), snake, tetris, crossy, dino, hangman, memory, maze, jigsaw, circle, doom, mario, trivia, airtype, uno.html (menu wrapper — rules live on `liveuno.html`), life.html (life calendar, not a game).

## ✅ Best Practices
-   **Images:** Use **WebP** or **SVG**. They are fully supported and perform best.
-   **Modals:** Always stick to the `.modal-overlay` / `.modal-box` DOM structure found in `weather.html`.
-   **Custom Selects:** `js/custom-select.js` replaces native `<select>` elements with a System 7 styled widget. Because the native select is hidden, the custom widget must explicitly respect the native `disabled` state and per-option `disabled` attributes via the `disabled` CSS class and early-return guards in the `CustomSelect` class (see the `updateDisabledState()`, `toggle()`, `open()`, `select()`, and `renderOptions()` methods). Without this, a disabled select will still appear interactive.
-   **Dark mode chrome:** `theme.js` applies a global `invert(1) hue-rotate(180deg)` filter in dark mode. Because `color-scheme: dark` changes the default canvas text color to white, the filter would invert that text back to black-on-black, so `theme.js` now also sets explicit `color: #000` on the dark root so the filter produces white text. White buttons, close boxes, and borders on light System 7 UI can also become black-on-black and disappear; add the `no-invert` helper class (re-inverted by `theme.js`) to any control that must stay visible in dark mode, e.g. `<div class="controls no-invert">` or `<button class="sys-btn no-invert">`. Note that `.no-invert` restores the original light colors, so text inside a `.no-invert` element with a transparent background may end up black-on-black; add a dark-mode `color: #fff` rule for that text (see `pet.html` `.btn-label`). **Note:** Dark mode is currently temporarily disabled — `theme.js` forces `light` mode and `settings.html` greys out/disables the theme dropdown.

## 🌐 External API Proxies (Rate-limiting)
External APIs such as Reddit aggressively rate-limit shared cloud egress IPs (e.g., Cloudflare Pages/Workers). Any proxy under `functions/api/` or `workers/` that calls an external API should:

- Cache successful GET responses using `caches.default` so all users share the same cached copy.
- Retry on `429 Too Many Requests` and `5xx` errors with exponential backoff, respecting any `Retry-After` header.
- Return stale cached data to the client when the upstream is rate-limiting, so the UI doesn't appear broken.
- Use different cache TTLs by content type (e.g., 60 s for RSS feeds, 5 min for images).

Example pattern: `functions/api/reddit.js`.

## 📋 Reporting System

Users can report content across all social apps. Reports are stored in Firestore and trigger Discord notifications.

### Architecture
- **Client Module:** `js/reports.js` — provides `rekindleOpenReportModal()` with System 7 styling
- **Backend Handler:** `workers/rekindle-moderate/worker.js` handles `type: "report"` requests
- **Storage:** RTDB `/reports` on the **social** project (`rekindle-socials`)
- **Notifications:** Discord bot via `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` environment variables. Fires on every report submission. Includes action buttons (Delete, Timeout, Dismiss) for manual moderation.

### Data Model (`/reports` RTDB)
Each entry is keyed by a Firebase push ID and contains:
```javascript
{
  reporterId, reporterName,
  reportedUserId, reportedUserName,
  contentType, contentId, contentPath,
  reason, comment, contentSnapshot,
  status: "pending" | "resolved" | "dismissed",
  createdAt, resolvedAt, resolvedBy, resolutionNote
}
```

### RTDB Rules
Reports live under `/reports` in `rtdb-social-rules.json`:
- `.read`: `ukiyo@rekindle.ink` or moderators
- `.write`: `ukiyo@rekindle.ink` or the social service account
- `.indexOn`: `["contentId", "contentType", "status", "createdAt"]`

### RTDB Indexes Required
Add this index in the Firebase Console under the social RTDB for the `/reports` node:
- `contentId`
- `contentType`
- `status`
- `createdAt`

### Rate Limits
- 60 reports per hour per user (enforced in moderation worker)

### Adding Report Buttons to New Social Apps
1. Include `<script src="js/reports.js"></script>` in the HTML `<head>`
2. Call `rekindleOpenReportModal({contentType, contentId, contentPath, reportedUserId, contentSnapshot})`

### Files Modified
- `js/reports.js` (new)
- `workers/rekindle-moderate/worker.js` — added report handler + Discord notification
- `kindlechat.html` — report buttons on messages
- `neighbourhood.html` — report buttons on posts and comments
- `topics.html` — report buttons on topics and comments
- `moderation.html` — added "User Reports" panel with pending/resolved/dismissed filters
- `firestore-social.rules` — added `reports` collection rules

### Discord Bot Setup
Set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` as Cloudflare Worker environment variables. **No fallback** — if not set, notifications are silently skipped. Never commit the bot token to the repository — use environment variables.

**Setup Steps:**
1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to "Bot" tab → Click "Reset Token" → Copy the token
3. Invite the bot to your server with "Send Messages", "Embed Links", and "Use Application Commands" permissions
4. Set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` as Cloudflare Worker secrets

**Auto-Deletion:** When 2 different users report the same content (same `contentType` + `contentId`), the content is automatically deleted and both reports are marked as "resolved". The Discord notification will show a green embed indicating the auto-deletion.

**Discord Action Buttons:** Each Discord notification includes 3 buttons:
- **Delete Content** — Manually deletes the reported content
- **Timeout User (24h)** — Applies a 24-hour timeout to the reported user
- **Dismiss Report** — Marks the report as resolved without action

To enable buttons, you must set up Discord Interactions:
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → Your Application
2. Go to "General Information" → Set "Interactions Endpoint URL" to: `https://rekindle-moderate.timjarnott.workers.dev/discord-interaction`
3. Set `DISCORD_PUBLIC_KEY` as a Cloudflare Worker environment variable (found in Discord Developer Portal under "General Information")

### RTDB Indexes Required
Reports live under `/reports` in the social RTDB. The dashboard reads from RTDB and filters/sorts in memory, but the worker query for existing reports uses `orderByChild('contentId').equalTo(...)`, so an index on `contentId` is required for performance at scale.

1. **Reports node:**
    - **Path:** `/reports`
    - **Index fields:** `contentId`

### Auto-Delete Behaviour
When 2 different users report the same content (same `contentType` + `contentId`), the worker attempts to automatically delete the content. If deletion succeeds, both reports are marked as `resolved`. If deletion fails (e.g. RTDB permission issue), both reports remain `pending` so moderators can review them manually. The Discord notification will indicate whether the auto-delete succeeded or failed.

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

## 🏉 NRL Scores (scores.html)

ESPN's JSON scoreboard API (`site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`) supports NFL/NBA/MLB/NHL/soccer/AFL but **does not expose NRL**. To add NRL, `scores.html` uses a dedicated Cloudflare Pages Function at `functions/api/nrl-scores.js` that scrapes `https://www.espn.com/nrl/scoreboard` and returns ESPN-compatible JSON.

*   The scraper is regex-based and relies on ESPN's current server-rendered HTML structure. If ESPN changes their markup, the parser will return empty events.
*   Only games where both teams are in the known NRL team list are returned (filters out State of Origin / Tests).
*   The response is cached for 2 minutes via `caches.default`, but only when games are successfully parsed.
*   In `scores.html`, NRL is added to `LEAGUES` with `source: "nrl-scores"`, and `fetchFromAPI()` routes it to `/api/nrl-scores` instead of the ESPN proxy.

## 📚 Comic Reader (comics.html) — Internet Archive, not MangaDex/Manga Plus

`comics.html` (dashboard id `comics`, formerly `manga.html`) was rewritten (2026-07) to remove MangaDex (unlicensed scanlations = piracy). It is now a **public domain / openly licensed comic reader** backed by the Internet Archive. The original MangaDex app survives untouched as `manga.html` (a copy of the old `mangadex.html`, still redirecting to `index`); it is not linked from the dashboard.

### Why not Manga Plus (official Shueisha)?
Manga Plus was evaluated and is **technically unusable** for this project:
1.  **Datacenter IP ban:** `jumpg-webapi.tokyo-cdn.com` returns a protobuf "Account Banned (10900)" error for ALL Cloudflare egress IPs (verified via the deployed `/api/proxy`) and VPN/unknown IPs. It only works from clean residential IPs.
2.  **CORS-locked:** the API only sends `access-control-allow-origin: https://mangaplus.shueisha.co.jp`, so the Kindle browser cannot call it directly.
3.  **Protobuf-only:** responses are `application/x-protobuf`; there is no JSON mode.

### Internet Archive integration (what the app uses)
*   **Catalog search:** `https://archive.org/advancedsearch.php?q=mediatype:texts AND collection:comics* AND licenseurl:*&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=20&page=N&sort[]=downloads desc&output=json`. The `licenseurl:*` filter is **mandatory** — the general `comics` collections are full of pirated Disney/manga scans; only items with an explicit license (public domain mark, CC) are legal. Sends `access-control-allow-origin: *`, so it is fetched **directly** (no proxy).
*   **Metadata:** `https://archive.org/metadata/{id}` — also CORS-open, direct fetch. Used to find the `*_scandata.xml` file. Note: `metadata.imagecount` is often absent, so page count must come from scandata.
*   **Scandata:** `https://archive.org/download/{id}/{file}_scandata.xml` — **does NOT send CORS headers**, so it is fetched through `/api/proxy` (IA does not ban cloud IPs). Parse with `DOMParser`, collect `<page leafNum="N">` where `addToAccessFormats != false`.
*   **Page images:** `https://archive.org/download/{id}/page/n{leaf}_w1080.jpg` — 302-redirects to `ia*.us.archive.org/BookReader/BookReaderImages.php`. Used as direct `<img src>` (no CORS needed for images).
*   **Covers:** `https://archive.org/services/img/{id}` — direct `<img src>`.
*   Items without scandata (CBZ-only uploads) cannot be read in-app; the reader shows an "Open on archive.org" fallback link.

### Library migration
Library items are stored in localforage key `manga_library` and must have `source: 'ia'` (IA identifier as `id`). Legacy MangaDex entries (UUID ids) are silently dropped on load with a status-bar notice.

### Dashboard entry
The `icons.js` entry uses `id: 'comics'` (file `comics.html`) with `name: 'Comics'`. All locale files translate `manga.title` as their word for "Comics".

## KindleChat Translations Listener Must Be Key-Scoped

**Never attach a bare-ref listener to `kindlechat/translations_by_lang/{lang}`.** Each language node holds every translation ever written (~25,000 entries / ~1.2 MB per language as of 2026-07, growing unboundedly). A bare `.on('child_added')` forces every client to download ~1 MB and process ~25k callbacks on every page load, which effectively kills the Kindle browser — this was the root cause of "translations not showing" even though the `rekindle-translate` worker was writing them correctly.

**Pattern (implemented in `kindlechat.html` `loadGeneralFromRTDB()`):**
- Push IDs sort chronologically, so scope the listener to the rendered window: `ref.orderByKey().startAt(oldestGeneralKey)` where `oldestGeneralKey` is the first (oldest) key from the initial `limitToLast(50)` messages load. This covers the live window plus all future messages (new keys are always greater).
- Paginated older messages (`loadMoreGeneralFromRTDB()`) are older than `startAt`, so fetch their translations individually on demand: `translations_by_lang/{lang}/{msgId}.once('value')`, cache into `langTranslations`, then re-render that bubble.
- New translation features that add listener paths must follow the same scoping rule.

To audit translation pipeline health, query RTDB directly with `service-account-social.json` (in repo root) via firebase-admin: compare `kindlechat/messages` timestamps against `kindlechat/translations_by_lang` keys.

## KindleChat Art Gallery & `kindlechat/art_index`

The KindleChat gallery (`kindlechat.html`) shows only pixel art and flipbooks. To avoid downloading every chat message, the gallery reads from a dedicated RTDB index at `kindlechat/art_index`.

### Architecture

- `kindlechat/art_index/{messageId}` stores a lightweight record for every art post:
  - `type`: `"pixel_art"` or `"flipbook"`
  - `uid`: author UID
  - `timestamp`: server timestamp
  - `thumbnail`: data URL (pixel art image or first flipbook frame)
  - `text`: caption text
- The gallery queries `art_index` ordered by `timestamp` and paginates with `limitToLast` + `endAt`.
- Clicking a gallery item fetches the full message from `kindlechat/messages/{messageId}` to show the large pixel art or play the full flipbook.
- Pixel-art saves from the gallery reuse `savePixelArtData()` with the current message cached in `window.galleryPixelArtData`; never put the base64 image URL into an inline `onclick` handler.
- `showPixelArtModal()` replaces `#generic-modal-content.innerHTML`, which destroys the default `#modal-message` and `#modal-btns` children. `showModal()` must rebuild those nodes and reset the generic modal's inline width/max-width before displaying another message.
- The moderation worker automatically writes the index entry when a pixel art or flipbook message is posted, and deletes it when a message is auto-deleted from a report.

### Files involved
- `workers/rekindle-moderate/worker.js` — writes/deletes index entries.
- `rtdb-social-rules.json` — security rules for `kindlechat/art_index`.
- `kindlechat.html` — gallery view reads from `art_index`.
- `scripts/backfill-art-index.js` — one-time migration to populate the index for existing art posts.

### Backfill

Existing pixel art and flipbook posts do not automatically appear in the index. Run the migration once:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/rekindle-socials-service-account.json
node scripts/backfill-art-index.js
```

### Important rule for future art features

Any new feature that posts pixel art or flipbooks to KindleChat must also write an entry to `kindlechat/art_index/{messageId}` with the same shape, or update the moderation worker to do it on the feature's behalf. Otherwise the gallery will not show those posts.


## KindleChat Pixel Art Duplicate Prevention

To stop users from reposting the exact same pixel art repeatedly in KindleChat, duplicate prevention is enforced both client-side and server-side.

### Client-side `postedToKindleChat` flag (`pixel.html`)

Each drawing in the user's manifest can carry a `postedToKindleChat: true` flag.

*   When a drawing is successfully posted to KindleChat, `postToPixelChat()` sets `item.postedToKindleChat = true` on the current manifest item and saves the manifest.
*   Before posting, `postToPixelChat()` checks the flag and shows a modal if the drawing has already been posted unchanged.
*   Any modification to the drawing (saved via `performSave()`) clears the flag to `false`, so the edited drawing can be posted again.
*   Translation key: `pixel.status.already_posted` — "This pixel art has already been posted to KindleChat. Modify it to post again."
*   Blank (all-white) pixel art is also blocked from posting. Use `pixel.status.blank` — "Blank pixel art cannot be posted."

### Server-side duplicate detection (`workers/rekindle-moderate/worker.js`)

*   Pixel art posts skip the text-only duplicate check (the placeholder text `"Shared a pixel art!"` would otherwise block different pixel art).
*   Instead, the worker hashes `body.grid_data` and checks `kindlechat/user_recent/{uid}/kindlechat_pixel_art/{hash}` for a 5-minute duplicate window.
*   After a successful post, the grid data hash is recorded under `kindlechat_pixel_art` for duplicate detection.
*   No RTDB rule changes are required: `kindlechat/user_recent/{uid}` is already writable by the social service account for any child path.


## 🎮 Single-Player Games Catalog

The dashboard (`index.html`) reads the app registry from `icons.js`. Games are grouped by the `cat` property:

| Category | Purpose |
| :--- | :--- |
| `games` | Single-player / solitaire games |
| `two_player` | Local pass-and-play multiplayer |
| `live_game` | Firebase real-time online multiplayer |

### Single-player vs multiplayer split

Several games exist as both a single-player file and a multiplayer file. The single-player version is the canonical game name (e.g. `chess.html`), and the local/online variants add a prefix (`2pchess.html`, `livechess.html`). Following this convention keeps the catalog consistent and avoids confusing users.

### Single-player games added

*   **Tic-Tac-Toe** — `tictactoe.html` (vs CPU with Easy/Hard). Based on `2ptictactoe.html`; uses a minimax AI on Hard and random on Easy.
*   **Connect 4** — `connect4.html` (vs CPU with Easy/Hard). Based on `2pconnect4.html`; supports the same 4-in-a-row and 5-in-a-row toggle. Hard mode uses minimax with alpha-beta pruning to depth 4 plus a heuristic window evaluation.
*   **Dots & Boxes** — `dotsandboxes.html` (vs CPU with Easy/Hard). Based on `2pdotsandboxes.html`. Easy is greedy-box. Hard completes boxes, avoids giving the opponent a 3-sided box, and prefers moves that set up future boxes.
*   **Battleship** — `battleship.html` (vs CPU). Based on `2pbattleships.html`. Player places ships manually or with Auto; CPU places ships randomly and fires using hunt/target mode after a hit.
*   **Uno** — `uno.html` (solo vs bots). A wrapper that launches `liveuno.html?single=1`. The live game detects the `single=1` parameter and automatically hosts a 4-player match with 3 bots, starting immediately. The `liveuno.html` menu also has a "Play Solo vs Bots" button for the same mode.

All new single-player files disable CSS animations/transitions (`* { transition: none !important; animation: none !important; }`) and reuse the same System 7 window/title-bar patterns as their 2-player counterparts.

### Game mode badges and folder grouping

Games that exist in multiple modes are grouped by name in the dashboard (`index.html` → `getGroupedApps()`). The folder modal uses mode badges instead of mode names as the icon labels:

| Mode | Property | Badge |
| :--- | :--- | :--- |
| Single-player | `single: true` in `icons.js` | `1P` (`one-p-label`) |
| Local 2-player | `cat: 'two_player'` | `2P` (`two-p-label`) |
| Live online | `live: true` | `LIVE` (`live-label`) |
| New app | `new: true` in `icons.js` | `NEW` (`new-label`) |

Single-player entries that have a multiplayer counterpart (e.g. `chess`, `checkers`, `pool`, `yahtzee`, `battleship`, `connect4`, `dotsandboxes`, `tictactoe`, `uno`) should set `single: true` so the folder items are labeled with the game name and the correct badge.

**Important:** Do **not** add `single: true` to games that are single-player-only and have no multiplayer variant in the project (e.g. `crossy`, `dino`). That flag is only for the folder-grouping badge system. For solid pixel-art icons, use `filled: true` instead.

## 🟦 Geometry Dash (gdash.html)

A Geometry Dash clone adapted from kindle-geometrydash.netlify.app (same 10 level strings and obstacle grammar), reworked for the System 7 window instead of fullscreen.

### Key differences from the reference implementation
*   **Canvas:** fixed 512×288 internal resolution, CSS-scaled (reference is fullscreen). `FLOOR_Y = 216`, `CEIL_Y = 40`, `PLAYER_X = 96`, obstacle step 130px, start x 520.
*   **Inverted gravity has a real ceiling:** inverted players land on and ride `CEIL_Y` and hop *down* over ceiling spikes (which hang from `CEIL_Y`). The reference clamps inverted players at `FLOOR_Y + 40` (below the floor — a bug there), do not copy that.
*   **Portals / speed gates / end flag span the full corridor** (`CEIL_Y`..`FLOOR_Y`) so they trigger at any altitude. Reference portals float at fixed offsets that only work on tall fullscreen canvases.
*   **Auto-restart on death** with an attempts counter (reference returns to menu). Practice mode restores the last checkpoint instead.
*   Physics (60Hz fixed timestep): gravity 1.0, jump -14, terminal 13, 80% hitbox, coyote 6 / buffer 7 frames. Triple spikes intentionally have only a ~3-frame jump window — matches the reference/GD tightness, do not "fix".
*   Progress: `localStorage` `gdash_progress_v1` (best % per level, 100 on completion), `gdash_simple_v1` disables death particles. No Firebase/leaderboard — if one is added, update `firestore.rules` per the rule checklist.

## 📓 Flipbook (flipbook.html) — Frame Corruption & Performance Fixes (2026-07)

A user report ("multiple clicks to open, drastic lag, flipbooks merge together, frames double") traced to four bugs, all now fixed:

1. **Doubled frames (re-entrancy):** `openAnimation()` had no loading feedback and no guard, so impatient extra taps re-entered it. Interleaved async decode loops each did `frames = []` then pushed into the shared global → 2N frames, persisted by autosave. Fix: `isOpening` guard, a `showLoadingModal()`/`hideLoadingModal()` overlay, and decoding into **local arrays** via `Promise.all(data.frames.map(decodeFrame))`, swapping the globals atomically only after all frames decode.
2. **Merged flipbooks (async ID race):** old `performSave()` read the global `currentAnimationId` *after* `await`ing thumbnail generation, so switching animations mid-save wrote A's frames under B's ID; a pending 1s autosave timer could also fire after `openAnimation` had assigned the new ID. Fix: `performSave()` is now fully synchronous up to the fire-and-forget Firestore write, captures `animId` up front, and `openAnimation()` clears the autosave timer + flushes `performSave()` for the old animation *before* assigning the new ID (`currentAnimationId = id` now happens only after a successful load).
3. **Lag (autosave re-encoding):** every autosave (1s after each stroke) re-encoded **every** frame to a 256×256 PNG data URL. Fix: `frameUrlCache[]` parallel to `frames[]` holds encoded PNGs; `saveCurrentFrame()` marks the edited index dirty (`null`), `getAllFrameUrls()` re-encodes only dirty frames, and `openAnimation()` seeds the cache from the stored base64 (an open-then-repost now encodes nothing). `createThumbnail()` is synchronous and reuses module-level scratch canvases.
4. **Lag (per-pointermove allocation):** `renderCanvas()` allocated a new 256×256 canvas on every pointermove for onion skin. Fix: one reusable `onionCanvas`, only re-`putImageData` when `currentFrameIndex` changes (`onionLoadedIndex`).

Also: `requirePro()` gates create/open — if the Firestore subscription check hasn't resolved yet (`subChecked === false`) it shows "Verifying subscription..." instead of flashing the paywall, which was part of the "multiple clicks" complaint. `localStorage.setItem` of animation data is wrapped in try/catch (64MB cache limit). When touching frame add/delete/save logic, keep `frameUrlCache` spliced/pushed in sync with `frames`.


