---
trigger: always_on
glob: "**/*"
description: Core compatibility and style rules for ReKindle development.
---

# ReKindle Development Rules

You are developing for a constrained environment (Kindle experimental browser based on Chromium 75). Adherence to these rules is mandatory.

## 🚫 Critical Constraints (Chromium 75)

### CSS
1.  **NO Flexbox `gap`**: Chromium 75 supports `gap` in Grid only.
    -   ❌ `display: flex; gap: 10px;` (BROKEN)
    -   ✅ Use `margin-left` / `margin-top` on flex children instead.
    -   ✅ `display: grid; gap: 10px;` is allowed.
2.  **NO Animations/Transitions**: E-ink refresh rates are too slow (7-15fps).
    -   ❌ `transition: all 0.3s ease;`
    -   ✅ `* { transition: none !important; animation: none !important; }`
3.  **Sticky Positioning**: Avoid `position: sticky` or `fixed` for headers/footers to prevent checkerboarding artifacts.

### JavaScript (ES2019 Ceiling)
1.  **Syntax Limit**: ES2019 is the hard maximum.
    -   ❌ **Forbidden**: Optional Chaining (`?.`), Nullish Coalescing (`??`). usage will CRASH the app.
    -   ✅ **Allowed**: `async`/`await`, Arrows, `const`/`let`.
2.  **Runtime**: V8 runs in **JIT-less** mode (`--js-flags="jitless"`).
    -   Execution is 5x-10x slower. Avoid heavy blocking loops on the main thread.
3.  **Alerts**: `window.alert()`, `confirm()`, `prompt()` are unsupported. Use custom modals.

### System & APIs
1.  **Date/Time**: `Intl` API is unreliable for timezones.
    -   ❌ Do not rely on system timezone.
    -   ✅ Use `time.js` helpers or manual offset calculations.
2.  **Storage**: `localStorage` is volatile (wiped on restart if >64MB global cache). Use Firebase for persistent data.
3.  **Viewport**: Always use `<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">`.

## 🎨 System 7 Design System

### Layout Patterns
1.  **Environment (`body`)**:
    -   Background: `#e5e5e5` (Desktop Gray).
    -   Font: "Geneva", "Verdana", sans-serif.
    -   `image-rendering: pixelated` key for crisp edges.
    -   Flex center the app window.
2.  **Window (`.window`)**:
    -   White background, 2px black border.
    -   Shadow: `4px 4px 0px #000000` (Hard shadow).
    -   Max width: ~600px.
3.  **Title Bar**:
    -   Must use purely CSS-based stripe pattern provided in `COMPATIBILITY.md`.
    -   Height: 35px.
    -   Close button on left (`X`).
4.  **Interactive Elements**:
    -   **Buttons**: `border: 2px solid black`, `box-shadow: 2px 2px 0 black`.
    -   **Active State**: `transform: translate(2px, 2px)` removes shadow.

### Z-Index Layering
Strict layering constants to prevent overlap issues.
-   `title-stripes`: `0` (Background pattern)
-   `title-text`: `1` (Sits above stripes)
-   `close-box`: `2` (Interactive top layer)
-   `modal-overlay`: `10000` (Always top-most)

### Assets & Icons
-   **Icons**: SVG strings in `icons.js`. 32x32 grid. Stroke width 1.5 or 2.
-   **Format**: WebP or SVG preferred.
-   **Emojis**: Strictly forbidden. The Kindle does not support Unicode emojis and will display broken square boxes. Use retro ASCII emoticons (e.g., `:)`, `:D`, `T_T`) or SVGs.

## 🌍 Localization (i18n)

-   Use `data-i18n="key"` for text.
-   Use `data-i18n-placeholder="key"` for inputs.
-   **Never** hardcode English text in HTML.
