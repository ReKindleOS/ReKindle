# Lite & Legacy build pipeline (e-reader browsers)

Read this before changing `build-automation.js`'s `transpileHtml` (Lite) or
`transpileLegacyHtml` (Legacy), or before debugging a page that works on desktop but not on a
Kobo/pre-Chromium Kindle.

## What the targets actually are

| Build | Devices | Engine |
| :--- | :--- | :--- |
| `main` | Chromium Kindles, desktop, phones | modern Chromium |
| `lite` | pre-Chromium Kindles (Mesquite) | WebKit ~534, ES5 only |
| `legacy` | Kobo Clara/HD/2E/BW/Colour, Libra, Sage, Elipsa | QtWebKit **AppleWebKit/538.1** (~2014), ES5 only |

Kobo's UA is a template: `Mozilla/5.0 (Linux; U; Android 2.0; en-us;) AppleWebKit/538.1 ...
(Kobo Touch <device-code>/<firmware>)`. It says "Kobo Touch" even on a Clara, and `index.html`
routes on `/Kobo/i` (`index.html:22`). All Clara models on 4.x firmware report 538.1; the 5.x
Tolino-derived beta is the only thing that may change that.

**Do not assume Kobo == Chromium 75.** The `chrome 12` Babel/PostCSS target is an approximation
for an even older desktop engine; 538.1 is between the two.

## The browser probe (`/probe`)

`probe.html` is shipped to all builds and linked from the LEGACY info modal. Open
`https://legacy.rekindle.ink/probe` on the device. It reports UA, build flag, JS APIs, CSS
support, and does a real `XMLHttpRequest` GET and a `fetch` GET for `/manifest.json`.

The critical row is **XHR GET manifest**. The whatwg-fetch polyfill is XHR-based. If XHR is
missing, defining `fetch` does not help and no Firebase/Auth/Firestore/AI/RSS feature can work.
The 2026 on-device report from a Libra Colour says both `fetch` and `XMLHttpRequest` are missing
(<https://robertcedwards.com/posts/eink-notepad-kobo/>), which conflicts with what QtWebKit
538.1 normally provides. Verify on the actual unit before promising network features.

## Subresource Integrity (fixed 2026-10-22)

The build localizes and transpiles CDN libraries into `libs/`. The source HTML kept the CDN
`integrity="sha384-..."` attribute, which can never match Babel's output, so the browser refused
to execute the local file. Nine pages were dead on every browser (not just Kobo): `reader`,
`chess`, `livechess`, `2pchess`, `interactive`, `flipbook`, `epub`, `docs`, `airtype`.

- Fix: `stripLocalScriptIntegrity($)` in `build-automation.js` removes `integrity` and
  `crossorigin` from every same-origin `<script src>`, called after the library replacement loop
  in **both** `transpileHtml` (Lite) and `transpileLegacyHtml` (Legacy).
- Verification: `grep -c integrity= _deploy/legacy/chess.html` should be `0` after a build, and
  `typeof firebase` / `typeof Chess` on `chess.html` should be `object` / `function` in WebKit.
- Do not "fix" this by recomputing hashes: the build regenerates `libs/` on every run.

## Extensionless local links (fixed 2026-10-22)

Cloudflare Pages answers `*.html` with **308** to the extensionless route. QtWebKit 538.1 and
WebKit 534 predate 308 support, and Lite/Legacy have no service worker to intercept it. A normal
tap on an app icon went to `/calculator.html` → 308 → blank.

- `rewriteLocalHtmlLinks(html)` in `build-automation.js` rewrites local `href="*.html"` values,
  inline `onclick` strings and `location.href`/`location.replace` literals. `index.html` maps to
  `/` because `/index` is itself a 308 on Pages. External URLs are skipped.
- `window.rekindleExtensionlessHref()` plus a capture-phase click handler in
  `OLD_BROWSER_DOM_SHIMS` catches anchors created at runtime by `index_old.html`.
- `index_old.html` also calls the helper for its two app-card generators.
- Verify: `grep -rho 'href="[^"]*\.html' _deploy/legacy/*.html` should return nothing.

## Polyfills for the old engine (`OLD_BROWSER_DOM_SHIMS`)

`core-js@2.6.12` covers language built-ins only. The injection block in `build-automation.js`
now also provides, before any page script:

- `AbortController` / `AbortSignal` (whatwg-fetch listens for `signal` abort events)
- `TextEncoder` / `TextDecoder` (UTF-8; WebCrypto credential apps)
- `String.prototype.matchAll` (`bad_words.js` calls it during filtering)
- `Element.prototype.append/prepend/before/after/replaceWith` (`journal`, `moderation`)
- `HTMLCanvasElement.prototype.toBlob` (`photoframe`, `mindmap` export)
- `window.rekindleExtensionlessHref` + click shim
- `window.rekindleHasWebCrypto` flag (for feature detection; `crypto.subtle` itself is **not**
  polyfilled — the apps using AES-GCM/PBKDF2 degrade when it is absent)

`OLD_BROWSER_DOM_SHIMS` is injected by both Lite and Legacy. Keep it ES5: it is inserted after
Babel has run, so `let`/arrow/template-literal syntax would parse-fail on the target devices.

## Dashboard layout

Old `-webkit-box` shrinks a fixed-width flex child: at 600px the 220px sidebar laid out at
166px even with `width: 220px !important` and `-webkit-box-flex: 0`, clipping "MULTIPLAYER
GAMES". The home CSS injection in both transpilers now switches `.dashboard` to `display: block`,
floats a 220px `.sidebar`, gives `.app-view` a 220px left margin, and stacks the sidebar above
the app view below 520px. Re-check at 600×800 and 732×762.

### The home layout is the user's choice — settings toggles must not switch it (2026-10-22)

`settings.html` `toggleService('games')` used to force `rekindle_layout` **and** the Firestore
`homeLayout` field to `'old'` whenever games were disabled, then never restore them when games were
re-enabled. `index.html` redirects to `index_old.html` on page load when that value is `'old'`
(lines 12-13), so "Disable Games" silently moved the account to the Classic home page for good.
Both dashboards hide games already (`areGamesDisabled()` in `icons.js` → `updateNavVisibility()`),
so the layout switch was redundant and has been removed. Any account that picked up
`homeLayout: 'old'` from the old build stays on the Classic page until Settings → Appearance →
Home Layout is set back to Modern.

## Build order and verification

```bash
node build-automation.js                 # all three targets
node --check build-automation.js         # syntax
npm test                                 # i18n/compat/proxy/claims/chat/DM/cleanup/OregonTrail/akinator

# no stale SRI
grep -c 'integrity=' _deploy/legacy/chess.html    # 0
# no .html navigation links in old builds (the only hit is /reddit.html inside
# a browser.html query string, not a path)
grep -rho 'href="[^"]*\.html' _deploy/legacy/*.html | head
# probe shipped
ls _deploy/legacy/probe.html _deploy/lite/probe.html _deploy/main/probe.html

scripts/shot-webkit.sh "http://127.0.0.1:8991/chess.html" 800 1000 /tmp/chess.png \
  'document.title="firebase:"+typeof firebase+" chess:"+typeof Chess'
```

## Old-engine layout fallbacks (2026-10-22)

Both old engines only have the 2009 flexbox. `addOldEngineLayoutFallbacks(html)` in
`build-automation.js` runs on the final HTML for Lite and Legacy, after PostCSS and the
app-specific CSS injections. It covers what PostCSS cannot see:

- `<style>` blocks and inline `style="..."` attributes: adds `display:-webkit-box` (and
  `-webkit-box-lines:multiple` for `flex-wrap:wrap`), plus `-webkit-box-align` / `-webkit-box-pack`
  for `align-items` / `justify-content`.
- Inline scripts and `onclick`/`onchange` handlers: rewrites `style.display = 'flex'` (including
  ternaries such as `open ? 'flex' : 'none'`) to `'-webkit-box'`. `paint`-time display switches are
  how modals and tabs open; without this they stay hidden on WebKit 534/538.1.
- It leaves the unprefixed value last in CSS, so modern WebKit still uses `flex`.

The visible symptoms this fixed: modals opening invisible or un-centred, tab panels never showing,
and game boards rendering as a single row.

### Game grids

The old-game CSS fixes now use `display:block` + `display:inline-block` cells rather than flex.
Inline-block wrapping is supported by every engine, so Lite and Legacy render the same board:

- 2048: 64px cells, `gap:0`, 300px board (fits the 282px content box).
- Sudoku: max-width 400px (leaves room for the number pad), `gap:0`, 11.11% cells.
- Minesweeper: 7.14% cells, 1px cell borders (the grid lines used to be the 1px flex gap).
- Crossword: 15x15 percentage cells, white background while the puzzle loads.
- Memory: 4 cards per row (`gap:0`, 22% + 1% margin).
- Chess/checkers: `#board` block, 12.5% squares.
- Battleship: 10x10 block/inline-block grid with `gap:0` (the 1px gap used to push the last column out).
- Cube Dash: level rows use floats (73% / 23%) so the PRACTICE button cannot be clipped.

`injectAfterCellClass()` exists because Babel/minification rewrites `cell.className = 'cell';`
to `cell.className="cell";`, which silently defeated the Crossword, Minesweeper and Nonograms
cell-size patches for months. Match the minified form (either quote style), not one literal string.

`crossword.html` also gained an English fallback for `crossword.direction.*`; the clue bar used to
show the raw key.

## Follow-up from the Lite visual audit (2026-10-22)

- **Browser empty state** — `browser.html` declared a page-local `let history`, which shadowed
  `window.history` and left `history.forEach` undefined, so `renderHistory()` threw and the RECENT
  pane stayed blank. Renamed to `visitHistory` in the source; the old post-build rename patch was
  removed (it ran after Babel and never matched the minified form).
- **Calendar first paint** — the page waited for `onAuthStateChanged` before calling
  `initNativeMode()`, so Guests saw "Loading..." for the whole auth round-trip. `loadLocalEvents()`
  now renders the local cache immediately; the cloud snapshot replaces it when auth resolves.
- **KindleChat guest state** — the auth handler waits 2.5 s for slow e-ink auth, and if the callback
  never fires the chat stayed on "Connecting..." indefinitely. Added a 6 s fallback to
  `handleKindlechatGuest()`. The guest overlay is now a dim scrim + white `.guest-card` instead of
  a 95% white wash.
- **Weather** — the 5-day list started empty and a slow/blocked request left it blank. It now shows
  a LOADING row, aborts the fetch after 12 s, and replaces the list with "Connection Error" on
  failure. (The audit harness showed the same blank on `main`; the loading/error state is the
  durable fix.)
- **Solitaire** — card widths came from a CSS custom property that the build strips, so the
  `@media` card-size overrides never applied and every card stayed 45×65. Explicit responsive sizes
  are injected for 600 px (65×94) and 800 px (80×116).

## Things still not fixed here

- `crypto.subtle` (WebCrypto) has no realistic polyfill. Mail/Substack/Mastodon/Bluesky/Dropbox
  credential save/load will fail on a browser without it; the app code catches the rejection but
  the user loses saved credentials.
- `canvas.toBlob` is polyfilled via `toDataURL`/`atob`; large canvases are slow and can hit memory
  limits on a 512MB device.
- QtWebKit 538.1 has no devtools or console. Use `/probe` for on-device diagnosis.
- The Kobo repaint quirk (post-load `<body>` class changes dropping elements) still applies to
  any new post-load styling; prefer setting classes on `<html>` in `<head>`.
