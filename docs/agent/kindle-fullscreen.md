# ReKindle Fullscreen for Jailbroken Kindles

Last updated: 2026-10-22. Status: v1.0, beta-quality on-device add-on.

This is the area doc for `kindle/`, `kindle.html`, the `?kiosk=1` mode in `theme.js`, the
Settings toggle, and the build packaging step. Read it before changing any of them.

## What it is

Amazon's browser normally surrounds ReKindle with a status bar, an address bar and the
Kindle desktop. On a **jailbroken Kindle on firmware 5.16.4+** (the Chromium browser) we
can stop the Kindle GUI and run the stock browser directly, so ReKindle owns the whole
e-ink panel. The launcher is a **scriptlet** (a `.sh` file in `/mnt/us/documents`), not a
KUAL extension. KUAL is obsolete on current firmware and does not work; the Universal
Hotfix that ships with modern jailbreaks provides scriptlets instead.

Hard constraints:

- **Firmware 5.16.4+ only.** The launcher checks for
  `/usr/bin/chromium/bin/kindle_browser` and refuses to stop anything if it is missing.
- **No rootfs changes.** It stops/starts the GUI, writes to `/mnt/us` and `/tmp`, and
  uses the stock browser. A reboot always recovers.
- **No daemon, no autostart.** Launch is explicit; exiting is the power button.
- **No new web dependencies.** The kiosk layout is CSS injected by `theme.js`, and the
  launcher only opens one URL.

## Files

| Path | Purpose |
| :--- | :--- |
| `kindle/ReKindle.sh` | The scriptlet. Stop GUI, launch Chromium, watch power, restore GUI. |
| `kindle/ReKindleStop.sh` | Recovery scriptlet: kill the browser, restore the screensaver and GUI. |
| `kindle/README.txt` | Plain-text install/use/recovery instructions shipped in the zip. |
| `kindle/rekindle-fullscreen.conf.example` | Optional `URL` / `DSF` / `CORD` overrides. |
| `kindle/version.json` | Single version source. `ReKindle.sh` and `ReKindleStop.sh` carry the same version; `scripts/test-kindle.js` fails on a mismatch. |
| `kindle.html` | User-facing guide: jailbreaking, install, exit, troubleshooting, uninstall. |
| `scripts/build-kindle.js` | Stages the zip, checksums, and standalone downloads. |
| `theme.js` | `?kiosk=1` / `?kiosk=0`, persisted `rekindle_kiosk`, scoped kiosk CSS, `rekindleSetKiosk()`. |
| `settings.html` | **Kindle Fullscreen** toggle (`toggle-kiosk`, `rekindle_kiosk`). |
| `docs/agent/kindle-fullscreen.md` | This file. |

## Launcher flow

1. `detect_init` picks `upstart` (`/etc/upstart`) or `sysv`.
2. `detect_dsf` reads `/sys/class/graphics/fb0/virtual_size` and picks a Chromium
   device-scale factor: `2` on screens >= 900 px wide, `1` below that. `REKINDLE_DSF` or
   `DSF=` in `/mnt/us/rekindle-fullscreen.conf` overrides it. `CORD` (default
   `0,215`) is the Chromium host-window position; set `0,0` if a model leaves a
   blank strip at the top.
3. It enables Wi-Fi if `com.lab126.cmd wirelessEnable` is `0`, then waits up to 10 s for
   `wlan0` to report `up`.
4. It saves and sets `com.lab126.powerd preventScreenSaver` to `1`.
5. `stop lab126_gui` (or `/etc/init.d/framework stop`), then `start kb` on upstart. The
   `start kb` call comes from the known-working `kindle-shortcut-browser` project and is
   guarded; do not remove it without on-device testing.
6. It launches the stock browser with the flags below.
7. A background watcher blocks on `/dev/input/event*` and exits on
   `EV_KEY`/`KEY_POWER`/value 1. `lipc-wait-event com.lab126.powerd powerButton` is the
   fallback when no input device is found.
8. On exit (power, browser death, signal), `cleanup` kills the browser, restores the
   screensaver property and restarts the GUI.

### Browser flags

These are the Kindle browser's low-end flags, copied from
[`kindle-shortcut-browser`](https://github.com/mitchellurgero/kindle-shortcut-browser)
(tested there on a KT4 / 5.18.1) and the MobileRead Chromium launch notes:

```
/usr/bin/chromium/bin/kindle_browser "$URL" \
  --no-zygote --no-sandbox --single-process \
  --skia-resource-cache-limit-mb=64 --disable-gpu --in-process-gpu \
  --disable-gpu-sandbox --disable-gpu-compositing \
  --enable-dom-distiller --enable-distillability-service \
  --force-device-scale-factor="$DSF" --js-flags=jitless \
  --content-shell-hide-toolbar --content-shell-host-window-cord="$CORD" \
  --force-gpu-mem-available-mb=32 --enable-grayscale-mode \
  --enable-low-end-device-mode --enable-low-res-tiling \
  --disable-site-isolation-trials \
  --user-agent="$USER_AGENT"
```

`--js-flags=jitless` matches ReKindle's Chromium 75 target and avoids JIT memory on the
Kindle. `--content-shell-hide-toolbar` + `--content-shell-host-window-cord=0,215` remove
the browser toolbar. `XDG_CONFIG_HOME=/mnt/us/system/browser/` keeps the browser profile
(and therefore the ReKindle login) on the USB partition across launches.

**If you change a flag, test on a real Kindle.** The stock browser wrapper accepts
Amazon-specific flags that are not in desktop Chromium; unknown flags can silently break
rendering.

## Kiosk mode (`?kiosk=1`)

`theme.js` handles the web side:

- The pretty-URL rewrite now appends `window.location.search`, so `?kiosk=1`,
  `?lang=de` and `?login=true` survive the `.html` → extensionless history replace.
  Without this, local `.html?kiosk=1` URLs silently lost the flag (found in the
  visual pass).
- `?kiosk=1` sets `localStorage.rekindle_kiosk = '1'`; `?kiosk=0` removes it. The flag is
  read with a small query-string parser (no `URLSearchParams` dependency).
- The `rekindle-kiosk` class is added to `<html>` **before** `init()` runs, and a single
  `<style id="rekindle-kiosk-style">` is injected only while the flag is on.
- CSS removes the desktop background, body padding, outer window border/shadow and the
  95%/90% sizing, then fills `100vw`/`100vh`. Index keeps its `.sys-menu-bar` (35 px) and
  fills the rest with `.desktop-wrapper`; every other page makes `.window` fixed.
- Dimensions divide by `--rekindle-scale`, matching the existing `.window.fullscreen`
  pattern, so a non-default ReKindle zoom still fills the panel. Fallback declarations
  (`width: 100vw` before the `calc`) keep old browsers from losing the whole rule.
- `.window` deliberately has **no z-index** in kiosk mode, and `.modal-overlay` is
  raised to `10000 !important`. Many pages put their modal overlay directly under
  `<body>` with z-index 100 (chess does); if `.window` were raised, those modals would
  be hidden behind the app. This was caught in the visual pass.
- `window.rekindleSetKiosk(on)` toggles it at runtime for the Settings checkbox;
  `window.rekindleIsKiosk()` is available for debugging.
- Settings → Display → **Kindle Fullscreen** (`toggle-kiosk`) writes the same flag. This is
  the escape hatch if a user opens ReKindle in the normal browser while the flag is set.

**Do not add `?kiosk=1` to normal navigation or links.** Only the launcher URL and the
guide's "turn it off" instructions mention it. Normal users should keep the framed layout.

**Cache busting:** `theme.js` is a shared script. Any change to it requires bumping
`theme.js?v=N` in every HTML file and in `sw.js` `ASSETS_TO_CACHE`. The kiosk work is
`?v=22`.

## Build and release

```bash
npm run build:kindle          # downloads/ only
npm run build                 # all three deploy targets, calls build:kindle for each
```

The zip is assembled from `kindle/` and contains:

```
README.txt
rekindle-fullscreen.conf.example
SHA256SUMS.txt
documents/
  ReKindle.sh
  ReKindleStop.sh
```

`build-automation.js` adds `kindle` to `ignoreList` (the source scripts are not served)
and writes `downloads/` into `_deploy/{main,lite,legacy}`, plus a short
`/kindle.sh` URL at each deploy root. `_headers` forces `Content-Disposition:
attachment` for `/downloads/*`.

### On-device browser downloads

Amazon's stock Kindle browser restricts downloads to a short allowlist of book
formats (the KindleBrowserPatch project exists specifically to remove that
filter), so a plain `.sh` link can be refused. The build therefore publishes:

| URL | Served as | Purpose |
| :--- | :--- | :--- |
| `/kindle.sh` | `text/plain`, filename `ReKindle.sh` | Short URL to type on the Kindle |
| `/downloads/ReKindle.sh` | `text/plain`, filename `ReKindle.sh` | Direct link |
| `/downloads/ReKindle.txt` | `text/plain`, filename `ReKindle.sh` | Browser-friendly alias; same bytes |
| `/downloads/ReKindleStop.txt` | same | Recovery script alias |

The guide uses `download="ReKindle.sh"` on the aliases. This works only if the
browser honours the `Content-Disposition`/`download` filename; if a browser saves
the file as `.txt`, the user must rename it on a computer. The ZIP remains the
reliable route. The aliases are generated by `scripts/build-kindle.js`; do not
commit them.

**Do not assume the placeholder is test-free.** The stock browser's allowlist
changes with firmware; a real-device download test is part of the release
checklist before advertising "one tap" install.

Release checklist when changing the launcher:

1. Bump `kindle/version.json` and the `VERSION=` line in **both** scripts.
2. Run `npm test` (`scripts/test-kindle.js` checks syntax, metadata, dry-run output,
   version consistency, and the zip contents).
3. On a real Kindle, test: `rekindle.ink/kindle.sh` download → appears in the library →
   launch → ReKindle loads → login persists → power exits → GUI returns. Test once on a
   600 px screen if you change `detect_dsf`.
4. Rebuild/deploy. The zip is generated, not committed (`/downloads/` is gitignored).

## Testing without a Kindle

```bash
bash -n kindle/ReKindle.sh
bash -n kindle/ReKindleStop.sh
REKINDLE_DRY_RUN=1 bash kindle/ReKindle.sh
node scripts/test-kindle.js
```

Dry-run prints the detected init type, DSF, URL, browser path, power device and the exact
browser command without touching `lipc`, `eips` or `/mnt/us`. On a Mac it reports
`init=sysv`, `power=none` and the fallback 1072 px DSF; that is expected.

For the web side, use the no-focus WebKit harness (see
[visual-audit.md](visual-audit.md)):

```bash
python3 scripts/serve-local.py 8899
scripts/shot-webkit.sh "http://127.0.0.1:8899/index.html?kiosk=1" 800 1000 /tmp/kiosk-index.png
scripts/shot-webkit.sh "http://127.0.0.1:8899/notes.html?kiosk=1" 600 800 /tmp/kiosk-notes.png
```

Check that the app fills the viewport, the title bar is intact, the content still scrolls,
and no desktop frame remains. Also check `?kiosk=0` returns to the normal layout.

## Known limitations / future work

- **Older Kindles (pre-5.16.4) are not supported by the fullscreen launcher.** They can
  still use ReKindle in the browser + Default Fullscreen. A KUAL/browser WAF launcher
  could cover them, but it needs a different browser patch path and testing.
- **Power-button exit is device-specific.** The watcher assumes the 32-bit `input_event`
  layout and `KEY_POWER` code 0x74. If a model reports a different input device, the
  `lipc-wait-event` fallback is used; if that also fails, the user must run
  `ReKindleStop.sh` or reboot. Adding a touch-corner exit gesture is future work.
- **Rotation is not supported in kiosk mode.** The kiosk CSS assumes 0 deg; the
  `theme.js` 90/270 body transform conflicts with the fixed full-viewport layout.
  The guide tells users to set Rotation to 0. If landscape becomes a requirement,
  add a `data-rekindle-rotation` attribute in `injectRotationStyle()` and mirror
  the rotation rules inside the kiosk sheet.
- **No battery/sleep integration.** `preventScreenSaver` is disabled while the browser is
  open. Do not add a deep-sleep loop without testing e-ink wake behaviour; a panel that
  shows a frozen ReKindle while the device is suspended is worse than a lit screen.
- **No autostart.** Booting straight into ReKindle would need an upstart/systemd unit on
  the rootfs (read-only, model-specific). Deliberately out of scope for v1.
- **`kindle.html` downloads only exist after a build.** For local preview, run
  `npm run build:kindle` first. The deployed site always has them.

## Sources / prior art

- [KindleModding: Jailbreaking](https://kindlemodding.org/jailbreaking/) and the
  [jailbreak wizard](https://kindlemodding.org/jailbreak-wizard.html) (model/firmware
  routing, hotfix, scriptlets).
- [KindleModding: Scriptlets](https://kindlemodding.org/kindle-dev/scriptlets.html)
  (metadata, `# DontUseFBInk`, hooks).
- [KindleModding: Installing Homebrew](https://kindlemodding.org/jailbreaking/whats-next/installing-homebrew.html)
  (KUAL is obsolete on current firmware).
- [kindle-shortcut-browser](https://github.com/mitchellurgero/kindle-shortcut-browser)
  (`stop lab126_gui` → `start kb` → direct Chromium launch, power watcher; firmware
  5.16.4+ only).
- [kindle-dash](https://github.com/kylemccreery/kindle-dash) (older PW1 browser
  `viewmodes="fullscreen"` patching and `app://com.lab126.browser/?view=`; useful if we
  ever add an older-firmware path).
