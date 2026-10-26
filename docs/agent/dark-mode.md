# Dark Mode

Read this before changing `theme.js` dark mode, adding a modal/overlay, or doing a dark-mode visual pass.

## Status (2026-10-26)

Dark mode is **re-enabled**. `settings.html` exposes Light / Dark / Auto (Night Time) again, and the saved preference syncs through `users/{uid}/settings/general.themeMode` like any other setting. The old temporary force-light block and the `#theme-select` `disabled` attribute are gone.

Auto mode uses the saved manual UTC offset (`rekindle_timezone_offset`) to compute the local hour; it must not call `rekindleGetZonedDate()` at startup because that can inject the timezone prompt before the app renders.

## How it works

`theme.js` puts `data-theme="dark"` on `<html>` and applies a global `filter: invert(1) hue-rotate(180deg)` to the root. The filter is still the only practical way to theme 140 legacy pages in one place. Four details make it usable:

1. **`color-scheme` is light, not dark.** Native inputs/selects render light, then the root filter turns them dark. With `color-scheme: dark` they render dark and invert back to bright white.
2. **Media is re-inverted.** `img`, `video`, `canvas` and `.no-invert` get the same filter again, which restores photos, game canvases and `no-invert` controls exactly (a double invert + double hue-rotate is identity).
3. **Black-on-transparent images opt out.** `.keep-white` sets `filter: none`, so the root filter turns the image white. The dashboard logo (`index.html` top bar) needs this; the About modal already had it. Do not add it to photos/QR codes (`donate.svg`, `discord.svg`) — those must keep their original colours.
4. **Scrims are special.** A `rgba(0,0,0,.45)` backdrop becomes a bright white wash under inversion. `theme.js`:
   - overrides known overlay selectors to `background-color: rgba(255,255,255,.55)` (renders as 55% black after inversion);
   - marks full-screen fixed/absolute scrims with `.rk-dark-scrim` (covers dynamically created report/age/IP-ban/timezone overlays) and watches for new nodes with a `MutationObserver`.
   `pro-gate.js` `paywallScrim()` follows the same inverted-source rule for `#paywall-overlay` because its inline `!important` background wins over a stylesheet.

## Page-specific fixes from the 2026-10-26 pass

| File | Fix |
| :--- | :--- |
| `theme.js` | Re-enable stored theme; `?theme=dark|light|auto` preview in `sessionStorage`; light `color-scheme`; dynamic scrim marking; auto-mode local hour; skip SW registration in preview mode. |
| `settings.html` | Enable the theme dropdown/options, restore the i18n description, save/sync the real value, clear the preview override on an explicit choice. |
| `index.html` / `index_old.html` | `logo.svg` in the top bar needs `keep-white` (otherwise black-on-black); restore real `themeMode` sync. |
| `moderation.html` | Load `theme.js` so the owner console obeys the theme. `probe.html` deliberately stays unthemed (it is a raw browser diagnostic). |
| `journal.html` | Month separator was an inline `background:black`; now `.journal-month-header` with a dark-mode override so inversion does not make a glaring white bar. |
| `strands.html` | `#clue-bar` black strip becomes white under inversion; dark-mode override keeps it a dark separator. |
| `maps.html` | Map tiles/canvas are re-inverted like photos by default, leaving a white map. In dark mode `.leaflet-tile` and `.maplibregl-canvas` use `filter:none`, so the root inversion darkens the map. |
| `pro-gate.js` | `#paywall-overlay` used an inline `!important` black scrim; `paywallScrim()` now emits the inverted white source so the scrim renders dark. |
| `scripts/shot-webkit.swift` | Optional seventh arg = seconds to wait after evaluation, for Firebase/login-settled captures. |

## Verification

Every root page (141, plus `index_old.html` separately) was captured at **800×1000** in dark mode after the pass. Signed-in states were captured with the owner-provided `tester` account; it is not ReKindle+, so Pro apps were verified at their (now dark) paywall, not behind it.

- `?theme=dark` (and the sessionStorage preview) **skips service-worker registration** and unregisters existing workers. A fresh SW calls `clients.claim()` → `controllerchange` → reload, which interrupts the WebKit snapshot and left filtered canvas/grid layers black. This is a test-harness fix; normal navigation keeps the SW.
- The Swift WebKit snapshot still has compositing quirks with root filters on fixed overlay backgrounds and some delayed canvases (it can show a white scrim even when the computed source is the inverted colour). Use Chromium (headless, mapped `rekindle.ink` host) for dark colour checks of overlays/canvas, and WebKit for layout. Never treat a WebKit snapshot alone as proof of a dark-mode colour failure.
- `probe.html` is intentionally light (diagnostics). Canvas apps (Sketchpad, Maze, Doom, Mario, Jumpy, Crossy, 8 Ball, Surfer, Blocks, Snake) keep their original light game surface because the canvas is re-inverted; that is expected.

## Checklist for a new app/page

1. Include `<script src="theme.js?v=N"></script>` (bump N when changing theme.js).
2. Put modals on `.modal-overlay` (or an id ending in `-overlay`) and give the scrim a dark translucent background; never a white 95% wash.
3. Test with `?theme=dark` and a visible modal: the backdrop must darken, the card must be dark with white text, and native selects/inputs must be dark.
4. Check any permanent black accent bar: add a `:root[data-theme="dark"]` override so inversion does not turn it white.
5. Check `<img>` icons: photos should stay original; black-on-transparent logos need `keep-white`.
6. Canvas/game surfaces are expected to stay light; do not add `no-invert` to them.
