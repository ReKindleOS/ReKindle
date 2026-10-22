#!/bin/bash
# Name: ReKindle Stop
# Author: ReKindle
# Icon: /mnt/us/documents/ReKindleCover.png
# Version: 1.0.0
# DontUseFBInk
#
# Emergency exit for ReKindle Fullscreen.
#
# Run this from the Kindle library (or over SSH) if the browser is stuck, the
# Kindle UI did not come back, or you need to stop the fullscreen session
# without pressing the power button.
#
# It kills the fullscreen Chromium process, re-enables the screensaver and
# restarts the Kindle GUI. It does not delete any ReKindle files.

LOG="/mnt/us/rekindle-fullscreen.log"
INIT_TYPE="upstart"

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] STOP: $*" >> "$LOG" 2>/dev/null
    return 0
}

refresh_screen() {
    command -v eips >/dev/null 2>&1 || return 0
    eips -c >/dev/null 2>&1
    eips -c >/dev/null 2>&1
    return 0
}

[ -d /etc/upstart ] && INIT_TYPE="upstart" || INIT_TYPE="sysv"

log "Stopping ReKindle Fullscreen"

if command -v killall >/dev/null 2>&1; then
    killall kindle_browser >/dev/null 2>&1 || true
fi

lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true

if [ "$INIT_TYPE" = "sysv" ]; then
    /etc/init.d/framework start >/dev/null 2>&1 || true
else
    start lab126_gui >/dev/null 2>&1 || true
    sleep 1
    if ! lipc-get-prop com.lab126.appmgrd activeApp >/dev/null 2>&1; then
        /etc/init.d/framework start >/dev/null 2>&1 || true
    fi
fi

refresh_screen
log "Done"
exit 0
