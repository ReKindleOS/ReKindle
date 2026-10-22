# ReKindle Fullscreen for Jailbroken Kindles

Last updated: 2026-10-22. Status: v1.0, beta-quality on-device add-on.

This is the area doc for `kindle/`, `kindle.html`, the cover, the KPM package and the build
packaging step. Read it before changing any of them.

## What it is

Amazon's browser normally surrounds ReKindle with a status bar, an address bar and the
Kindle desktop. On a **jailbroken Kindle on firmware 5.16.4+** (the Chromium browser) we
can stop the Kindle GUI and run the stock browser directly, so ReKindle has the whole
screen without the Kindle UI or browser chrome. ReKindle itself keeps its normal framed
layout; the launcher does not stretch the dashboard or apps. The launcher is a **scriptlet** (a `.sh` file in `/mnt/us/documents`), not a
KUAL extension. KUAL is obsolete on current firmware and does not work; the Universal
Hotfix that ships with modern jailbreaks provides scriptlets instead.

Hard constraints:

- **Firmware 5.16.4+ only.** The launcher checks for
  `/usr/bin/chromium/bin/kindle_browser` and refuses to stop anything if it is missing.
- **No rootfs changes.** It stops/starts the GUI, writes to `/mnt/us` and `/tmp`, and
  uses the stock browser. A reboot always recovers.
- **No daemon, no autostart.** Launch is explicit; exiting is the power button.
- **No new web dependencies and no app-level fullscreen.** The launcher opens the normal
  `rekindle.ink` URL; the existing framed desktop/app layout is unchanged.

## Files

| Path | Purpose |
| :--- | :--- |
| `kindle/ReKindle.sh` | The scriptlet. Stop GUI, launch Chromium, watch power, restore GUI. |
| `kindle/ReKindleStop.sh` | Recovery scriptlet: kill the browser, restore the screensaver and GUI. |
| `kindle/ReKindleCover.png` | Library cover referenced by `# Icon:` in both scriptlets (400x640 grayscale). |
| `kindle/README.txt` | Plain-text install/use/recovery instructions shipped in the zip. |
| `kindle/rekindle-fullscreen.conf.example` | Optional `URL` / `DSF` / `CORD` overrides. |
| `kindle/version.json` | Single version source. `ReKindle.sh`, `ReKindleStop.sh` and the KPM manifest carry the same version; `scripts/test-kindle.js` fails on a mismatch. |
| `kindle/kpm/` | KPM `manifest.json`, `install.sh` (copies scriptlets to `documents`) and `uninstall.sh` (removes them). |
| `kindle.html` | User-facing guide: jailbreaking, install, exit, troubleshooting, uninstall. |
| `scripts/build-kindle.js` | Stages the zip, KPM `.kpkg`/repo, checksums, and standalone downloads. |
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

## Display behavior

The launcher's "fullscreen" is **only** the removal of the Kindle GUI and browser
chrome. It opens `https://rekindle.ink/` with no `?kiosk` parameter. The dashboard
keeps its desktop frame, and apps open in their normal System 7 windows at their
designed size. Do not add an app-level fullscreen/stretch mode to the launcher.

The existing **Settings → Default Fullscreen** toggle is a separate, user-controlled
per-app feature and is unchanged; it is not part of this add-on.

**Cache busting:** `theme.js` is a shared script. The kiosk mode was removed from it, so
bump `theme.js?v=N` in every HTML file and in `sw.js` `ASSETS_TO_CACHE` (`?v=23`).
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
  ReKindleCover.png
```

`build-automation.js` adds `kindle` to `ignoreList` (the source scripts are not served)
and writes `downloads/` into `_deploy/{main,lite,legacy}`, plus a short
`/kindle.sh` URL at each deploy root. `_headers` forces `Content-Disposition:
attachment` for `/downloads/*`.

### On-device installs

**Direct browser downloads do not work on stock firmware.** The browser allows
only book formats and checks the **saved filename/type**. On 2026-10-22 both
`/kindle.sh` and the `.txt` alias were tested on a real Kindle and rejected with
"Invalid file type"; renaming the URL or serving `text/plain` does not bypass the
filter. The `.txt` aliases remain published for browsers with the restriction
removed (KindleBrowserPatch), but they are **not** the supported install path.

The supported no-computer route is **KPM**, which is included with current
WinterBreak/SpringBreak jailbreaks. KPM downloads with the shell, so the browser
filter is never involved:

```sh
;kpm add-repo https://rekindle.ink/downloads/kpm/repo.json
;kpm update
;kpm install rekindle-fullscreen
```

`scripts/build-kindle.js` generates `downloads/kpm/rekindle-fullscreen_<version>_kindlehf.kpkg`
and `downloads/kpm/repo.json`. The `.kpkg` is a gzipped tar with `manifest.json`
(v2), `install.sh`, `uninstall.sh`, `ReKindle.sh` and `ReKindleStop.sh` at the
root. `install.sh` copies both scriptlets to `/mnt/us/documents`; `uninstall.sh`
removes them. Keep the manifest version in sync with `kindle/version.json`
(`scripts/test-kindle.js` checks it).

The ZIP remains the fallback for users without KPM. Direct `.sh`/`.txt` URLs and
`/kindle.sh` / `/kindle.txt` are still built for patched browsers and as an
escape hatch, but the guide labels them "may be blocked".

Release checklist when changing the launcher:

1. Bump `kindle/version.json`, the `VERSION=` line in **both** scripts, and the
   KPM manifest version.
2. Run `npm test` (`scripts/test-kindle.js` checks syntax, metadata, dry-run output,
   version consistency, zip and KPM package contents/repo JSON).
3. On a real Kindle, test: KPM install → scriptlets appear in the library → launch →
   ReKindle loads → login persists → power exits → GUI returns. Test once on a 600 px
   screen if you change `detect_dsf`.
4. Rebuild/deploy. The zip/KPM artifacts are generated, not committed (`/downloads/`
   is gitignored).

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
scripts/shot-webkit.sh "http://127.0.0.1:8899/index.html" 800 1000 /tmp/index.png
scripts/shot-webkit.sh "http://127.0.0.1:8899/notes.html" 600 800 /tmp/notes.png
scripts/shot-webkit.sh "http://127.0.0.1:8899/kindle.html" 600 800 /tmp/kindle.png
```

Check the normal framed layout is intact (desktop frame, 95%/90vh window). The launcher
must not change it; there are no kiosk screenshots to take anymore.

## Known limitations / future work

- **Older Kindles (pre-5.16.4) are not supported by the fullscreen launcher.** They can
  still use ReKindle in the browser + Default Fullscreen. A KUAL/browser WAF launcher
  could cover them, but it needs a different browser patch path and testing.
- **Power-button exit is device-specific.** The watcher assumes the 32-bit `input_event`
  layout and `KEY_POWER` code 0x74. If a model reports a different input device, the
  `lipc-wait-event` fallback is used; if that also fails, the user must run
  `ReKindleStop.sh` or reboot. Adding a touch-corner exit gesture is future work.
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
