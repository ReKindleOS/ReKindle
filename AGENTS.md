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

### Icons (SVG)
Icons are stored as raw SVG strings in `icons.js`.
*   **Size:** Designed for **32x32** pixel grid.
*   **Stroke:** `stroke-width="2"` (Standard) or `"1.5"` for detail.
*   **Style:** `fill="none"` `stroke="black"` OR `fill="black"` `stroke="none"`.

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
*   **RTDB Rules:** `rtdb-social-rules.json` — KindleChat messages, translations, user limits.
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

## ✅ Best Practices
-   **Images:** Use **WebP** or **SVG**. They are fully supported and perform best.
-   **Modals:** Always stick to the `.modal-overlay` / `.modal-box` DOM structure found in `weather.html`.
-   **Update this file:** When you discover a cross-cutting concern, gotcha, or project-wide pattern during implementation, update `AGENTS.md` immediately so future agents don't relearn it the hard way.
-   **`.title-text` height:** All 122 HTML files standardize `.title-text` with `display: inline-flex; align-items: center; height: 100%; box-sizing: border-box;` so the white background fully covers the title-bar stripes. Do not remove these properties.
