# ReKindle for Jailbroken Kindles

Last updated: 2026-10-25. Status: v1.2.1, **highly experimental** - labelled as such in
every user-facing mention.

This is the area doc for `kindle/`, `kindle.html`, the cover, the KPM package and the build
packaging step. Read it before changing any of them.

## "Highly experimental" labelling (2026-10-25)

The add-on is a community experiment: it changes how a Kindle starts its browser, it has
very little real-device testing, and a failed launch can leave the device stuck until it
reboots. It is deliberately marked **highly experimental** everywhere a user can find it.
Keep these in sync when the copy changes:

| Where | What carries the label |
| :--- | :--- |
| `help-data.js` `kindle-fullscreen` | `badges: ['HIGHLY EXPERIMENTAL']`, the opening `.note warn` box, and the `Highly experimental:` summary prefix |
| `help-data.js` `welcome` / `install` | the inline notes that link to `#kindle-fullscreen` |
| `help.html` | `.badge.exp` (inverted badge) and `.note.warn` (left-bar warning box) |
| `kindle.html` | `<title>` suffix, kicker, inverted "Highly experimental" pill, the warning callout under the lead, the safety list and the footer |
| `README.md` | section heading suffix and the bold warning paragraph |
| `kindle/README.txt` | `STATUS: HIGHLY EXPERIMENTAL` block, the recovery note and the EXPERIMENTAL SOFTWARE section |

Do not soften or remove these labels until there has been on-device testing across models
and the launcher is actually supported. Help text is English-only, so nothing here goes
into `locales/`; bump `help-data.js?v=` in `help.html` after editing the article.

## What it is

On a **jailbroken Kindle on firmware 5.16.4+**, the optional ReKindle launcher stops the
Kindle GUI, mounts the stock Chromium image, and launches `kindle_browser` on
`rekindle.ink`. It then watches the power button and restarts the GUI on exit. ReKindle
keeps its normal framed layout; the launcher does not stretch the dashboard or apps.

**1.0.13 makes the library scriptlet re-exec `kpm launch rekindle` when it is unprivileged.** Earlier 1.0.2/1.0.3 used
`appmgrd` + `com.lab126.chromebar configureChrome` (browser-app mode). That kept the GUI
and blanked the URL bar, but it could not produce a true fullscreen launch. 1.0.4 instead
mirrors Amazon's own `/usr/bin/browser`.

### What the 5.19.6 firmware actually does

The public 5.19.6 Paperwhite 12 update was extracted and inspected. Findings:

- `/usr/bin/browser` is a bash script. As root it re-execs itself as `framework`:
  ```sh
  if [[ "$(whoami)" = "root" ]]; then
      exec su - framework /usr/bin/browser
  fi
  ```
- It sets `XDG_CONFIG_HOME=/mnt/us/system/browser/`, cleans that cache if over 64 MB, and
  sets `LD_LIBRARY_PATH=/usr/bin/chromium/lib:/usr/bin/chromium/usr/lib:/usr/lib/`.
- It execs `/usr/bin/chromium/kindle_browser` with:
  ```text
  --skia-resource-cache-limit-mb=64
  --disable-gpu --in-process-gpu --disable-gpu-sandbox --disable-gpu-compositing
  --disable-seccomp-filter-sandbox
  --enable-dom-distiller --enable-distillability-service
  --force-device-scale-factor=2 --js-flags="--jitless"
  --content-shell-hide-toolbar --content-shell-host-window-cord=0,215
  --force-gpu-mem-available-mb=64 --enable-low-end-device-mode --enable-low-res-tiling
  --disable-site-isolation-trials --user-agent=...
  --enable-grayscale-mode --disable-xi2
  ```
- **No `--no-sandbox`, `--no-zygote` or `--single-process`.** Chromium runs as
  `framework`, so the normal sandbox works.
- `/usr/bin/chromium` is an **empty mountpoint** in the rootfs; the binaries and libs are
  in `/usr/bin/chromium.sqsh`. The squashed tree has `kindle_browser`, `libchromium.so`,
  `icudtl.dat`, fonts and `.pak` files at its root; there is **no `bin/` and no
  `swiftshader/`**. The binary's interpreter is `/lib/ld-linux-armhf.so.3`.
- `/chroot` is empty on 5.19.6. (5.16.4–5.18 used
  `chroot /chroot /usr/bin/chromium/bin/kindle_browser`.)

`kindle/ReKindle.sh` therefore:

1. Uses `/usr/bin/chromium/kindle_browser` if already mounted.
2. Otherwise mounts `/usr/bin/chromium.sqsh` at `/usr/bin/chromium` with
   `mount -t squashfs -o loop,ro`.
3. On 5.16.4–5.18, falls back to `/chroot/usr/bin/chromium/bin/kindle_browser`.
4. Writes a `/tmp/rekindle-browser-$$.sh` wrapper and runs it with
   `su - framework`, with the 5.19.6 flags above and the configured URL.
5. Stops `lab126_gui`, starts `kb` (upstart), and starts the browser.
6. Watches `/dev/input/event*` for `KEY_POWER` (value 1), with
   `lipc-wait-event com.lab126.powerd powerButton` as fallback.
7. On exit kills the browser, unmounts `chromium.sqsh` if it mounted it, restores the
   screensaver property and restarts the GUI.

## Files

| Path | Purpose |
| :--- | :--- |
| `kindle/ReKindle.sh` | The scriptlet: mount sqsh, stop GUI, launch Chromium as framework, restore GUI. |
| `kindle/ReKindleStop.sh` | **Not installed.** Source-only legacy recovery; ZIP/KPM omit it. |
| `kindle/ReKindleCover.png` | Library cover referenced by `# Icon:` (400x640 grayscale). |
| `kindle/README.txt` | Plain-text install/use instructions shipped in the zip. |
| `kindle/rekindle-fullscreen.conf.example` | Optional `URL`, `DSF`, `CORD` overrides. |
| `kindle/version.json` | Single version source. Both scripts and the KPM manifest carry it. |
| `kindle/kpm/` | KPM manifest, install hook and uninstall hook. |
| `kindle.html` | User-facing guide. |
| `scripts/build-kindle.js` | Stages the ZIP, KPM `.kpkg`/repo, checksums, downloads. |
| `docs/agent/kindle-fullscreen.md` | This file. |

## Logs and failure reporting

- `/mnt/us/rekindle-fullscreen.log` — full log.
- `/mnt/us/documents/ReKindle Log.txt` — last 120 lines, copied at launch and exit.
- `/mnt/us/documents/ReKindle Error.txt` — firmware, browser path, chroot/mount state and
  log tail on failure/early exit.

A browser exit within 10 seconds is treated as a crash and writes the error report. That
does not catch a browser that stays alive but paints white; the log tail is the diagnostic
there.

## KPM repo and packaging

`scripts/build-kindle.js` generates `downloads/kpm/rekindle_<version>_kindlehf.kpkg` and
`downloads/kpm/repo.json`. The `.kpkg` is a gzipped tar with `manifest.json` (v2),
`install.sh`, `uninstall.sh`, `ReKindle.sh` and `ReKindleCover.png` at the root.
`supported_platforms` is `null`: the package is shell-only; do not add a platform filter
or KPM indexes it with no artifacts (`Could not find artifact`). `install.sh` copies the
scriptlet/cover to `/mnt/us/documents`, removes any old `ReKindleStop.sh`, and marks the
script executable. Keep the manifest version in sync with `kindle/version.json`.

`repo.rekindle.ink` is a custom domain on the `rekindle` Pages project, shadowed by
the **`rekindle-kpm` Worker route** (`workers/rekindle-kpm/`, route
`repo.rekindle.ink/*`). The Worker maps `/` and `/repo.json` to
`/downloads/kpm/repo.json` and `/<name>.kpkg` to `/downloads/kpm/<name>.kpkg` on the
main site, returning 200 with the right Content-Type. It only runs for repo-host
requests (~1k/day). The documented repo URL is
`https://rekindle.ink/downloads/kpm/repo.json`; the short
`https://repo.rekindle.ink` also works. Deploy the Worker with
`cd workers/rekindle-kpm && npx wrangler deploy` (the route is in its
`wrangler.toml`). Pages `_redirects` cannot do this: domain-level rules are not
supported, and a path rule would apply to every host on the project.

**Do not re-add `functions/_middleware.js` to shorten the repo URL (2026-10-25).**
Cloudflare Pages runs Pages Functions middleware for every request to the project,
not just the paths it acts on. Adding it on 2026-10-22 to map the repo host took
Pages Functions from ~2k to 96,188 / 101,275 / 89,327 invocations on Oct 22-24
(zone traffic was flat), pushing the account to ~122k Worker invocations/day. The
repo host itself gets ~1k requests/day. The Worker route does the same job with
zero Pages Function invocations.

KPM's search bar cannot pass a URL to `add-repo`: Amazon's `scriptExecutor` whitelists only
`[A-Za-z0-9/_ -]`, so `:` and `.` are rejected. Use kterm (`;kpm install kterm`, then
`kpm add-repo ...`) or USB.

## Testing

```bash
bash -n kindle/ReKindle.sh
bash -n kindle/ReKindleStop.sh
REKINDLE_DRY_RUN=1 bash kindle/ReKindle.sh
node scripts/test-kindle.js
```

Dry-run prints the version, firmware, DSF, URL, `chromium.sqsh` path and the
framework/chroot plan. It must not print `appmgrd` or `configureChrome` — those are the
removed 1.0.2/1.0.3 path.

On a real 5.19.6, check:
1. `/usr/bin/chromium/kindle_browser` is absent before launch and present after the mount.
2. Log shows `su - framework` and a browser PID.
3. ReKindle paints; no white screen.
4. Power exits and the GUI returns.
5. `umount /usr/bin/chromium` succeeds after exit.

## Known limitations

- **The exact 5.19.6 browser flags may vary by model.** The current set is from the
  Paperwhite 12 / 5.19.6 `/usr/bin/browser`. Colorsoft/Scribe builds may need their own
  `/usr/bin/browser` inspection; the mount/framework structure is the same.
- **Mount/unmount is root-only.** Scriptlets run as root; do not move this to a
  non-root launcher without an alternate mount path.
- **White screen with a live process is not auto-detected.** The error report only
  triggers on an early process exit. Compare the log's Chromium stderr and the stock
  browser for GPU/sandbox errors.
- **`--no-sandbox`/`--single-process` were intentionally removed.** They were the main
  difference from Amazon's launcher and are the suspected cause of the 5.19.6 white
  screen. Do not re-add them without on-device testing.
- **No app-level fullscreen.** The launcher opens the normal `rekindle.ink` URL; the
  framed desktop/app layout is unchanged.

## Sources

- Public 5.19.6 Paperwhite 12 update:
  `https://s3.amazonaws.com/firmwaredownloads/update_kindle_all_new_paperwhite_12th_5.19.6.bin`
- [onepointfive-REAL/kindle-browser-stuff](https://github.com/onepointfive-REAL/kindle-browser-stuff)
- [kindle-shortcut-browser issue #10](https://github.com/mitchellurgero/kindle-shortcut-browser/issues/10)
- [MobileRead: PW5 Chromium launcher dump](https://www.mobileread.com/forums/showthread.php?t=357173)
