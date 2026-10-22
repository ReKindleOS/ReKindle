#!/bin/bash
# Name: ReKindle Fullscreen
# Author: ReKindle
# Version: 1.0.0
# DontUseFBInk
#
# ReKindle Fullscreen - run rekindle.ink without the Kindle UI or browser
# chrome on a jailbroken Kindle (firmware 5.16.4+, Chromium browser).
#
# Copy this file to /mnt/us/documents/ and tap it in your Kindle library.
# The companion ReKindleStop.sh restores the Kindle UI if the browser or this
# script is interrupted.
#
# What it does:
#   1. Stops the Kindle GUI (lab126_gui) to free the whole display and memory.
#   2. Launches the stock Chromium browser on https://rekindle.ink/?kiosk=1
#      with the same low-end flags Amazon uses (JIT disabled, low-memory mode).
#   3. Watches the power button. One press exits the browser and restarts the
#      Kindle UI.
#
# It does not modify the root filesystem, install a daemon, or touch Amazon
# content. Everything it changes is reverted on exit.
#
# Recovery: hold the power button until the Kindle reboots, or run
# ReKindleStop.sh from your library after the UI is back.
#
# Optional config file: /mnt/us/rekindle-fullscreen.conf
#   URL="https://rekindle.ink/?kiosk=1"
#   DSF="2"          # Chromium device scale factor (1, 1.5, 2)
#   CORD="0,215"     # Chromium host-window position
#
# Environment overrides: REKINDLE_URL, REKINDLE_DSF, REKINDLE_CORD,
# REKINDLE_DRY_RUN=1

VERSION="1.0.0"
CONF="/mnt/us/rekindle-fullscreen.conf"
LOG="/mnt/us/rekindle-fullscreen.log"
POWER_FLAG="/tmp/rekindle-fullscreen-power"
URL="https://rekindle.ink/?kiosk=1"
CORD="0,215"
BROWSER="/usr/bin/chromium/bin/kindle_browser"
USER_AGENT="Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+"
DRY_RUN="${REKINDLE_DRY_RUN:-0}"
LOG_OK=0
[ -d /mnt/us ] && LOG_OK=1
DSF=""
INIT_TYPE="upstart"
GUI_STOPPED=0
BROWSER_PID=""
WATCH_PID=""
PREVENT_SS=""

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Optional user config. Keep it sourced after the defaults so it can override
# them, then let environment variables win.
if [ -f "$CONF" ]; then
    . "$CONF"
fi
URL="${REKINDLE_URL:-$URL}"
DSF="${REKINDLE_DSF:-$DSF}"
CORD="${REKINDLE_CORD:-$CORD}"

log() {
    local line
    line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    if [ "$LOG_OK" = "1" ]; then
        echo "$line" >> "$LOG" 2>/dev/null
    fi
    [ "$DRY_RUN" = "1" ] && echo "$line"
    return 0
}

plan() {
    [ "$DRY_RUN" = "1" ] && echo "PLAN: $*"
    return 0
}

run() {
    if [ "$DRY_RUN" = "1" ]; then
        echo "RUN: $*"
        return 0
    fi
    "$@"
}

refresh_screen() {
    command -v eips >/dev/null 2>&1 || return 0
    eips -c >/dev/null 2>&1
    eips -c >/dev/null 2>&1
    return 0
}

say_screen() {
    command -v eips >/dev/null 2>&1 || return 0
    eips -c >/dev/null 2>&1
    eips 2 2 "ReKindle" >/dev/null 2>&1
    eips 2 3 "$1" >/dev/null 2>&1
    return 0
}

fail() {
    log "ERROR: $*"
    if [ "$DRY_RUN" != "1" ]; then
        say_screen "Error - see log"
        sleep 6
    fi
    exit 1
}

detect_init() {
    if [ -d /etc/upstart ]; then
        INIT_TYPE="upstart"
    else
        INIT_TYPE="sysv"
    fi
}

detect_dsf() {
    [ -n "$DSF" ] && return 0
    local width=""
    if [ -r /sys/class/graphics/fb0/virtual_size ]; then
        width=$(cut -d, -f1 < /sys/class/graphics/fb0/virtual_size 2>/dev/null)
    fi
    case "$width" in
        ''|*[!0-9]*) width=1072 ;;
    esac
    if [ "$width" -ge 900 ]; then
        DSF="2"
    else
        DSF="1"
    fi
}

stop_gui() {
    [ "$GUI_STOPPED" = "1" ] && return 0
    GUI_STOPPED=1
    log "Stopping Kindle GUI ($INIT_TYPE)"
    if [ "$INIT_TYPE" = "sysv" ]; then
        run /etc/init.d/framework stop >/dev/null 2>&1 || true
    else
        run stop lab126_gui >/dev/null 2>&1 || true
        sleep 1
        # The Chromium browser expects this service after the GUI is stopped.
        # It is present on 5.16.4+ firmware; ignore it if this model lacks it.
        run start kb >/dev/null 2>&1 || true
    fi
    refresh_screen
}

start_gui() {
    [ "$GUI_STOPPED" = "1" ] || return 0
    GUI_STOPPED=0
    log "Restarting Kindle GUI"
    if [ "$INIT_TYPE" = "sysv" ]; then
        run /etc/init.d/framework start >/dev/null 2>&1 || true
    else
        run start lab126_gui >/dev/null 2>&1 || true
        sleep 1
        # Some firmware needs the framework service as well.
        if ! lipc-get-prop com.lab126.appmgrd activeApp >/dev/null 2>&1; then
            run /etc/init.d/framework start >/dev/null 2>&1 || true
        fi
    fi
    refresh_screen
}

restore_screensaver() {
    [ "$DRY_RUN" = "1" ] && return 0
    if [ -n "$PREVENT_SS" ]; then
        lipc-set-prop com.lab126.powerd preventScreenSaver "$PREVENT_SS" >/dev/null 2>&1 || true
    else
        lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
    fi
}

enable_wifi() {
    local state=""
    command -v lipc-get-prop >/dev/null 2>&1 || return 0
    state=$(lipc-get-prop com.lab126.cmd wirelessEnable 2>/dev/null)
    if [ "$state" = "0" ]; then
        log "Enabling Wi-Fi"
        lipc-set-prop com.lab126.cmd wirelessEnable 1 >/dev/null 2>&1 || true
        local i=0
        while [ "$i" -lt 10 ]; do
            state=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)
            [ "$state" = "up" ] && break
            sleep 1
            i=$((i + 1))
        done
    fi
}

find_power_device() {
    local dev name
    for dev in /dev/input/event*; do
        [ -e "$dev" ] || continue
        name=$(cat "/sys/class/input/$(basename "$dev")/device/name" 2>/dev/null)
        case "$name" in
            *Power*|*power*|*gpio-keys*|*gpio_keys*)
                echo "$dev"
                return 0
                ;;
        esac
    done
    # Known fallbacks on Kindle hardware.
    if [ -e /dev/input/event1 ]; then
        echo /dev/input/event1
        return 0
    fi
    if [ -e /dev/input/event0 ]; then
        echo /dev/input/event0
        return 0
    fi
    return 1
}

read_event_hex() {
    if command -v hexdump >/dev/null 2>&1; then
        dd if="$1" bs=16 count=1 2>/dev/null | hexdump -v -e '16/1 "%02X"'
    else
        dd if="$1" bs=16 count=1 2>/dev/null | od -An -tx1 -N16 | tr -d ' \n'
    fi
}

watch_power() {
    local dev event type code value
    dev=$(find_power_device) || dev=""
    if [ -z "$dev" ]; then
        # Fallback for models where the input device name is not useful.
        if command -v lipc-wait-event >/dev/null 2>&1; then
            log "Watching power button via lipc-wait-event"
            lipc-wait-event com.lab126.powerd powerButton >/dev/null 2>&1
            touch "$POWER_FLAG" 2>/dev/null
            return 0
        fi
        log "No power button device found; use ReKindleStop.sh to exit"
        return 1
    fi
    log "Watching power button on $dev"
    while true; do
        event=$(read_event_hex "$dev")
        if [ -z "$event" ]; then
            sleep 1
            continue
        fi
        # input_event: timeval[8] type[2] code[2] value[4] (32-bit Kindle).
        # EV_KEY=0x0100, KEY_POWER=0x7400, value=1 (press).
        type=${event:16:4}
        code=${event:20:4}
        value=${event:24:8}
        if [ "$type" = "0100" ] && [ "$code" = "7400" ] && [ "$value" = "01000000" ]; then
            log "Power button pressed; exiting fullscreen"
            touch "$POWER_FLAG" 2>/dev/null
            return 0
        fi
    done
}

cleanup() {
    trap - EXIT INT TERM
    if [ -n "$WATCH_PID" ]; then
        kill "$WATCH_PID" >/dev/null 2>&1 || true
    fi
    if [ -n "$BROWSER_PID" ]; then
        kill "$BROWSER_PID" >/dev/null 2>&1 || true
        sleep 1
        kill -9 "$BROWSER_PID" >/dev/null 2>&1 || true
    fi
    if [ "$DRY_RUN" != "1" ] && command -v killall >/dev/null 2>&1; then
        killall kindle_browser >/dev/null 2>&1 || true
    fi
    restore_screensaver
    start_gui
    rm -f "$POWER_FLAG" >/dev/null 2>&1 || true
    log "Stopped"
    exit 0
}

launch_browser() {
    log "Launching $URL (scale $DSF)"
    if [ "$DRY_RUN" = "1" ]; then
        echo "BROWSER: $BROWSER \"$URL\" --force-device-scale-factor=$DSF --js-flags=jitless --content-shell-hide-toolbar --content-shell-host-window-cord=$CORD"
        return 0
    fi
    export XDG_CONFIG_HOME="/mnt/us/system/browser/"
    export LD_LIBRARY_PATH="/usr/bin/chromium/lib:/usr/bin/chromium/usr/lib:/usr/lib/"
    mkdir -p /mnt/us/system/browser 2>/dev/null || true
    nohup "$BROWSER" "$URL" \
        --no-zygote --no-sandbox --single-process \
        --skia-resource-cache-limit-mb=64 --disable-gpu --in-process-gpu \
        --disable-gpu-sandbox --disable-gpu-compositing \
        --enable-dom-distiller --enable-distillability-service \
        --force-device-scale-factor="$DSF" --js-flags=jitless \
        --content-shell-hide-toolbar --content-shell-host-window-cord="$CORD" \
        --force-gpu-mem-available-mb=32 --enable-grayscale-mode \
        --enable-low-end-device-mode --enable-low-res-tiling \
        --disable-site-isolation-trials \
        --user-agent="$USER_AGENT" \
        >> "$LOG" 2>&1 &
    BROWSER_PID=$!
    log "Browser PID $BROWSER_PID"
}

wait_for_exit() {
    rm -f "$POWER_FLAG" >/dev/null 2>&1 || true
    watch_power &
    WATCH_PID=$!
    while true; do
        if ! kill -0 "$BROWSER_PID" >/dev/null 2>&1; then
            log "Browser exited"
            break
        fi
        if ! kill -0 "$WATCH_PID" >/dev/null 2>&1; then
            if [ -f "$POWER_FLAG" ]; then
                break
            fi
            # Power watcher could not start (unknown input device). Keep the
            # browser alive until it exits; ReKindleStop.sh / reboot recovers.
            WATCH_PID=""
            wait "$BROWSER_PID" >/dev/null 2>&1
            break
        fi
        sleep 1
    done
}

check_kindle() {
    if [ ! -d /mnt/us ]; then
        echo "ReKindle Fullscreen: this does not look like a Kindle (/mnt/us missing)."
        exit 2
    fi
    if [ ! -x "$BROWSER" ]; then
        fail "Kindle firmware 5.16.4+ required (Chromium browser not found)."
    fi
}

rotate_log() {
    [ "$LOG_OK" = "1" ] || return 0
    [ -f "$LOG" ] || return 0
    local size
    size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
    if [ "$size" -gt 65536 ] 2>/dev/null; then
        mv "$LOG" "$LOG.old" >/dev/null 2>&1 || true
    fi
}

main() {
    rotate_log
    log "ReKindle Fullscreen v$VERSION starting (dry-run=$DRY_RUN)"
    detect_init
    detect_dsf

    if [ "$DRY_RUN" = "1" ]; then
        echo "PLAN: version=$VERSION init=$INIT_TYPE dsf=$DSF"
        echo "PLAN: url=$URL"
        echo "PLAN: browser=$BROWSER"
        echo "PLAN: power=$(find_power_device 2>/dev/null || echo none)"
        echo "PLAN: sequence=prevent-screensaver -> stop-gui -> launch-browser -> watch-power -> restore-gui"
        launch_browser
        exit 0
    fi

    check_kindle
    enable_wifi

    PREVENT_SS=$(lipc-get-prop com.lab126.powerd preventScreenSaver 2>/dev/null)
    lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
    refresh_screen

    say_screen "Starting fullscreen..."
    sleep 1
    stop_gui
    launch_browser
    if [ -z "$BROWSER_PID" ]; then
        fail "Could not start the browser."
    fi
    wait_for_exit
}

trap cleanup EXIT INT TERM
main "$@"
