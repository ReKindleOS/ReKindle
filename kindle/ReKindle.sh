#!/bin/bash
# Name: ReKindle
# Author: ReKindle
# Icon: /mnt/us/documents/ReKindleCover.png
# Version: 1.2.1
# DontUseFBInk
#
# ReKindle - open rekindle.ink in the Kindle stock browser and blank the
# browser's URL bar. The Kindle GUI/status bar stays alive, so brightness,
# Wi-Fi and the normal swipe-down controls keep working.
#
# This build does not stop the GUI, mount Chromium, or need root. It works
# from the library tile and from `kpm launch rekindle`.

VERSION="1.2.1"
CONF="/mnt/us/rekindle-fullscreen.conf"
LOG="/mnt/us/rekindle-fullscreen.log"
ERROR_FILE="/mnt/us/documents/ReKindle Error.txt"
LOG_COPY="/mnt/us/documents/ReKindle Log.txt"
URL="https://rekindle.ink/"
CHROME_JSON="${CHROME_JSON:-}"
HYBRID="${HYBRID:-1}"
GUI_STOPPED=0
WATCH_PID=""
BRIGHT_PID=""
LIPC_WATCH_PID=""
PREVENT_SS=""
DRY_RUN="${REKINDLE_DRY_RUN:-0}"
FW_VERSION=""
APP_WATCH_PID=""
LOG_OK=0

if [ -d /mnt/us ] && touch "$LOG" 2>/dev/null; then
    LOG_OK=1
else
    LOG="/tmp/rekindle-fullscreen.log"
    if touch "$LOG" 2>/dev/null; then LOG_OK=1; fi
fi

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ -f "$CONF" ]; then
    . "$CONF"
fi
URL="${REKINDLE_URL:-$URL}"
CHROME_JSON="${REKINDLE_CHROME_JSON:-$CHROME_JSON}"
HYBRID="${REKINDLE_HYBRID:-$HYBRID}"
if [ -z "$CHROME_JSON" ]; then
    CHROME_JSON='{"appId":"com.lab126.browser","topNavBar":{"template":"blank","height":0},"searchBar":{"template":"none"}}'
fi

log() {
    local line
    line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    [ "$LOG_OK" = "1" ] && echo "$line" >> "$LOG" 2>/dev/null
    [ "$DRY_RUN" = "1" ] && echo "$line"
    return 0
}

say_screen() {
    command -v eips >/dev/null 2>&1 || return 0
    eips -c >/dev/null 2>&1
    eips 2 2 "ReKindle v$VERSION" >/dev/null 2>&1
    eips 2 3 "$1" >/dev/null 2>&1
    return 0
}

copy_log() {
    [ "$LOG_OK" = "1" ] || return 0
    [ -d /mnt/us/documents ] || return 0
    [ -f "$LOG" ] || return 0
    tail -120 "$LOG" > "$LOG_COPY" 2>/dev/null || true
}

write_error_report() {
    {
        echo "ReKindle could not start"
        echo "Time: $(date)"
        echo "Error: $*"
        echo ""
        echo "Firmware: ${FW_VERSION:-unknown}"
        [ -r /etc/version.txt ] && cat /etc/version.txt 2>/dev/null
        echo ""
        echo "Mode: browser-app (stock browser + blank URL bar; GUI stays running)"
        echo "URL: $URL"
        echo ""
        echo "appmgrd active app:"
        lipc-get-prop com.lab126.appmgrd activeApp 2>/dev/null || true
        echo ""
        echo "chromebar config:"
        lipc-get-prop com.lab126.chromebar lastChromeConfig 2>/dev/null || true
        echo ""
        echo "Last log lines:"
        tail -60 "$LOG" 2>/dev/null
    } > "$ERROR_FILE" 2>/dev/null || true
}

fail() {
    log "ERROR: $*"
    write_error_report "$*"
    if [ "$DRY_RUN" != "1" ]; then
        say_screen "Error - see ReKindle Error.txt"
        sleep 6
    fi
    exit 1
}

detect_firmware() {
    if [ -r /etc/version.txt ]; then
        FW_VERSION=$(head -n 1 /etc/version.txt 2>/dev/null | tr -d '[:space:]')
    fi
    if [ -z "$FW_VERSION" ] && command -v lipc-get-prop >/dev/null 2>&1; then
        FW_VERSION=$(lipc-get-prop com.lab126.system version 2>/dev/null | tr -d '[:space:]')
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

browser_running() {
    command -v pgrep >/dev/null 2>&1 || return 1
    pgrep -f 'kindle_browser' >/dev/null 2>&1 && return 0
    pgrep -f '/usr/bin/chromium' >/dev/null 2>&1 && return 0
    return 1
}

stop_gui() {
    [ "$GUI_STOPPED" = "1" ] && return 0
    GUI_STOPPED=1
    log "Stopping Kindle GUI"
    trap '' TERM
    stop lab126_gui >> "$LOG" 2>&1 || true
    sleep 1
    command -v initctl >/dev/null 2>&1 && initctl stop lab126_gui >> "$LOG" 2>&1 || true
    trap - TERM
    sleep 2
}

start_gui() {
    [ "$GUI_STOPPED" = "1" ] || return 0
    log "Restoring Kindle GUI"
    cd / && start lab126_gui >> "$LOG" 2>&1 || true
    sleep 1
}

write_input_report() {
    {
        echo "ReKindle input devices"
        echo "Time: $(date)"
        echo ""
        cat /proc/bus/input/devices 2>/dev/null
        echo ""
        if command -v evtest >/dev/null 2>&1; then
            evtest --list 2>&1 || true
        fi
    } > "/mnt/us/documents/ReKindle Inputs.txt" 2>/dev/null || true
}

find_touch_device() {
    local ev name caps
    for ev in /dev/input/event*; do
        [ -r "$ev" ] || continue
        name=$(basename "$ev")
        caps="/sys/class/input/$name/device/capabilities/abs"
        [ -r "$caps" ] || continue
        if grep -qwE '35|36' "$caps"; then
            echo "$ev"
            return 0
        fi
        name=$(cat "/sys/class/input/$(basename "$ev")/device/name" 2>/dev/null)
        case "$name" in
            *[Tt]ouch*|*[Tt]pd*|*[Tt]s*|*cyttsp*|*elan*|*synaptics*) echo "$ev"; return 0 ;;
        esac
    done
    return 1
}

find_power_device() {
    local ev name caps
    for ev in /dev/input/event*; do
        [ -r "$ev" ] || continue
        name=$(basename "$ev")
        caps="/sys/class/input/$name/device/capabilities/key"
        [ -r "$caps" ] || continue
        if grep -qw '7400' "$caps"; then
            echo "$ev"
            return 0
        fi
    done
    echo /dev/input/event1
}

adjust_brightness() {
    local delta="$1" cur new
    cur=$(lipc-get-prop com.lab126.powerd flIntensity 2>/dev/null)
    case "$cur" in
        ''|*[!0-9]*) cur=12 ;;
    esac
    new=$((cur + delta))
    [ "$new" -lt 0 ] && new=0
    [ "$new" -gt 24 ] && new=24
    if lipc-set-prop com.lab126.powerd flIntensity "$new" >/dev/null 2>&1; then
        log "Brightness $cur -> $new"
    else
        log "Brightness set failed (flIntensity=$cur, wanted $new)"
    fi
}

watch_lipc_power() {
    command -v lipc-wait-event >/dev/null 2>&1 || return 1
    lipc-wait-event com.lab126.powerd powerButton >/dev/null 2>&1 || return 1
    log "lipc powerButton event"
    touch /tmp/rekindle-power 2>/dev/null
}

watch_power() {
    local dev event type code value
    dev=$(find_power_device)
    [ -r "$dev" ] || return 1
    while true; do
        event=$(dd if="$dev" bs=16 count=1 2>/dev/null | hexdump -v -e '16/1 "%02X"')
        [ -n "$event" ] || continue
        type=${event:16:4}
        code=${event:20:4}
        value=${event:24:8}
        if [ "$type" = "0100" ] && [ "$code" = "7400" ] && [ "$value" = "01000000" ]; then
            log "Power button pressed"
            touch /tmp/rekindle-power 2>/dev/null
            return 0
        fi
    done
}

watch_brightness() {
    local dev line type code value height width start_y start_x done active
    dev=$(find_touch_device) || { log "No touchscreen device for brightness gesture"; return 0; }
    width=1072; height=1448
    if [ -r /sys/class/graphics/fb0/virtual_size ]; then
        width=$(cut -d, -f1 < /sys/class/graphics/fb0/virtual_size 2>/dev/null)
        height=$(cut -d, -f2 < /sys/class/graphics/fb0/virtual_size 2>/dev/null)
    fi
    case "$width" in ''|*[!0-9]*) width=1072 ;; esac
    case "$height" in ''|*[!0-9]*) height=1448 ;; esac
    log "Brightness gesture on $dev (${width}x${height})"
    active=0; done=0; start_y=""; start_x=""
    while true; do
        line=$(dd if="$dev" bs=16 count=1 2>/dev/null | hexdump -v -e '2/4 "%u " 2/2 "%u " 1/4 "%d"')
        [ -n "$line" ] || continue
        set -- $line
        type=$3; code=$4; value=$5
        if [ "$type" = "1" ] && [ "$code" = "330" ]; then
            if [ "$value" = "1" ]; then
                active=1; done=0; start_y=""; start_x=""
            else
                active=0; start_y=""
            fi
        elif [ "$type" = "3" ] && [ "$active" = "1" ]; then
            case "$code" in
                57)
                    if [ "$value" -ge 0 ]; then active=1; done=0; start_y=""; start_x=""; fi
                    ;;
                0|53) [ -z "$start_x" ] && start_x=$value ;;
                1|54)
                    if [ -z "$start_y" ]; then
                        start_y=$value
                    elif [ "$done" = "0" ]; then
                        if [ $((value - start_y)) -gt 110 ] && [ "$start_y" -lt $((height / 6)) ]; then
                            if [ -n "$start_x" ] && [ "$start_x" -gt $((width / 2)) ]; then
                                adjust_brightness 3
                            else
                                adjust_brightness -3
                            fi
                            done=1
                        fi
                    fi
                    ;;
            esac
        fi
    done
}

run_fullscreen() {
    [ "$(id -u 2>/dev/null)" = "0" ] || return 1
    log "FULLSCREEN root mode: appmgrd browser, then stop GUI"
    write_input_report
    PREVENT_SS=$(lipc-get-prop com.lab126.powerd preventScreenSaver 2>/dev/null)
    lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
    lipc-set-prop com.lab126.appmgrd start "app://com.lab126.browser#going?url=$URL" >> "$LOG" 2>&1 || fail "appmgrd could not start the browser."
    local i=0
    while [ "$i" -lt 15 ]; do
        browser_running && break
        sleep 1
        i=$((i + 1))
    done
    browser_running || fail "Browser process did not start."
    sleep 4
    lipc-set-prop com.lab126.chromebar configureChrome "$CHROME_JSON" >> "$LOG" 2>&1 || true
    say_screen "Starting fullscreen..."
    stop_gui
    browser_running || fail "Browser exited when the Kindle GUI stopped."
    watch_power &
    WATCH_PID=$!
    watch_lipc_power &
    LIPC_WATCH_PID=$!
    watch_brightness &
    BRIGHT_PID=$!
    while browser_running; do
        [ -f /tmp/rekindle-power ] && break
        sleep 1
    done
    log "Browser closed or power pressed"
}

launch_browser_app() {
    log "BROWSER_APP mode: appmgrd browser + custom chromebar; GUI remains running"
    command -v lipc-set-prop >/dev/null 2>&1 || fail "lipc-set-prop is unavailable."
    lipc-set-prop com.lab126.appmgrd start "app://com.lab126.browser#going?url=$URL" >> "$LOG" 2>&1 || fail "appmgrd could not start the browser."

    local i=0
    while [ "$i" -lt 15 ]; do
        browser_running && break
        sleep 1
        i=$((i + 1))
    done
    browser_running || fail "The browser process did not start."

    (
        while browser_running; do
            lipc-set-prop com.lab126.chromebar configureChrome "$CHROME_JSON" >> "$LOG" 2>&1 || true
            sleep 1
        done
    ) &
    APP_WATCH_PID=$!
    copy_log
    say_screen "ReKindle is open"

    while browser_running; do
        sleep 2
    done
    log "Browser closed; Kindle GUI/status bar was never stopped"
}

cleanup() {
    trap - EXIT INT TERM
    if [ -n "$APP_WATCH_PID" ]; then kill "$APP_WATCH_PID" >/dev/null 2>&1 || true; fi
    if [ -n "$WATCH_PID" ]; then kill "$WATCH_PID" >/dev/null 2>&1 || true; fi
    if [ -n "$BRIGHT_PID" ]; then kill "$BRIGHT_PID" >/dev/null 2>&1 || true; fi
    if [ -n "$LIPC_WATCH_PID" ]; then kill "$LIPC_WATCH_PID" >/dev/null 2>&1 || true; fi
    command -v killall >/dev/null 2>&1 && killall kindle_browser >/dev/null 2>&1 || true
    if [ -n "$PREVENT_SS" ]; then lipc-set-prop com.lab126.powerd preventScreenSaver "$PREVENT_SS" >/dev/null 2>&1 || true; fi
    start_gui
    rm -f /tmp/rekindle-power
    log "Stopped"
    copy_log
    exit 0
}

main() {
    detect_firmware
    log "ReKindle v$VERSION starting (browser-app, firmware=${FW_VERSION:-unknown}, dry-run=$DRY_RUN)"
    copy_log

    if [ "$DRY_RUN" = "1" ]; then
        echo "PLAN: version=$VERSION firmware=${FW_VERSION:-unknown}"
        if [ "$HYBRID" = "1" ]; then
            echo "PLAN: mode=root fullscreen + brightness gesture"
        else
            echo "PLAN: mode=browser-app (GUI/status bar stays)"
        fi
        echo "PLAN: url=$URL"
        echo "PLAN: app=app://com.lab126.browser#going?url=$URL"
        echo "PLAN: chrome=$CHROME_JSON"
        exit 0
    fi

    [ -d /mnt/us ] || fail "This does not look like a Kindle (/mnt/us missing)."
    enable_wifi
    if [ "$HYBRID" = "1" ] && [ "$(id -u 2>/dev/null)" = "0" ]; then
        run_fullscreen
        exit 0
    fi
    say_screen "Opening ReKindle..."
    launch_browser_app
}

trap cleanup EXIT INT TERM
main "$@"
