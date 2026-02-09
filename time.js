(function () {
    // --- SHARED TIMEZONE HELPERS ---
    // Single source of truth for "Mixed Browser Timezone" fix

    function getGlobalTimeZone() {
        try {
            const globalLoc = JSON.parse(localStorage.getItem('rekindle_location_manual'));
            return globalLoc && globalLoc.zone ? globalLoc.zone : (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
        } catch (e) {
            return 'UTC';
        }
    }

    function getDateInZone(date = new Date(), zone) {
        // PRIORITY: Check for robust Manual Offset (Automatic or User Set)
        // BUT ONLY if we are requesting the "Local" time or the "Manual Location's" time.
        // Otherwise, we break other timezones in Clocks app.
        const manualLocStr = localStorage.getItem('rekindle_location_manual');
        let manualZone = null;
        let offsetHours = null;

        // Primary source: utc_offset inside rekindle_location_manual (backwards compatible)
        if (manualLocStr) {
            try {
                const loc = JSON.parse(manualLocStr);
                manualZone = loc.zone || null;
                if (typeof loc.utc_offset === 'number') {
                    offsetHours = loc.utc_offset;
                }
            } catch (e) { }
        }

        // Fallback: separate rekindle_timezone_offset key (legacy)
        if (offsetHours === null) {
            const offsetStr = localStorage.getItem('rekindle_timezone_offset');
            if (offsetStr) {
                offsetHours = parseFloat(offsetStr);
                if (isNaN(offsetHours)) offsetHours = null;
            }
        }

        const isTargetingUserZone = !zone || (manualZone && zone === manualZone);

        // ALWAYS use manual offset for user's zone (never trust browser timezone)
        if (offsetHours !== null && isTargetingUserZone) {
            if (!isNaN(offsetHours)) {
                // Calculate wall clock components:
                // 1. Get UTC milliseconds from the input date
                const utcMs = date.getTime();
                // 2. Create a temp Date at the UTC time PLUS the offset
                const shifted = new Date(utcMs + (offsetHours * 3600000));
                // 3. Extract UTC components (which now represent wall-clock time in target zone)
                const y = shifted.getUTCFullYear();
                const mo = shifted.getUTCMonth();
                const d = shifted.getUTCDate();
                const h = shifted.getUTCHours();
                const mi = shifted.getUTCMinutes();
                const s = shifted.getUTCSeconds();
                // 4. Construct a new Date from these components as LOCAL values
                //    The Date's .get*() methods will return wall-clock values
                return new Date(y, mo, d, h, mi, s);
            }
        }

        if (!zone) zone = getGlobalTimeZone();
        try {
            const options = {
                timeZone: zone,
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour: 'numeric', minute: 'numeric', second: 'numeric',
                hour12: false
            };
            const s = date.toLocaleString('en-US', options);
            // "M/D/YYYY, HH:mm:ss"
            const [datePart, timePart] = s.split(', ');
            const [m, d, y] = datePart.split('/').map(Number);
            const [h, min, sec] = timePart.split(':').map(Number);

            // Return wall-clock date object (local components match target zone)
            return new Date(y, m - 1, d, h, min, sec);
        } catch (e) {
            console.error("Shared Timezone Error", e);
            return date;
        }
    }

    function getZonedDate(date = new Date()) {
        return getDateInZone(date, getGlobalTimeZone());
    }

    // Format a date object (which acts as source timestamp) into a specific format string relative to Global Zone
    function formatGlobalTime(date, options = {}) {
        // Unified Logic: Convert to Wall Date first, then format "as is"
        // This ensures consistent behavior between calculations and display
        const wallDate = getDateInZone(date);
        return formatWallDate(wallDate, options);
    }

    // Format a "Wall Date" (a Date where .get*() methods return wall-clock values)
    function formatWallDate(wallDate, options = {}) {
        // Just format the Date's local representation - the Date was constructed
        // so that its local components match the desired wall-clock time
        try {
            return wallDate.toLocaleString('en-US', options);
        } catch (e) {
            return wallDate.toLocaleString('en-US', options);
        }
    }

    // --- TIMEZONE OFFSET WARNING ---
    // Displays a modal if the user has not configured their timezone offset.
    function checkTimezoneOffset() {
        // Check for offset in rekindle_location_manual (primary) or rekindle_timezone_offset (legacy)
        const manualLocStr = localStorage.getItem('rekindle_location_manual');
        if (manualLocStr) {
            try {
                const loc = JSON.parse(manualLocStr);
                if (typeof loc.utc_offset === 'number') {
                    return; // Offset found in location data, no action needed.
                }
            } catch (e) { }
        }

        // Fallback check for legacy key
        const offsetStr = localStorage.getItem('rekindle_timezone_offset');
        if (offsetStr !== null && offsetStr !== '') {
            return; // Legacy offset is set, no action needed.
        }

        // Check if modal already exists (prevent duplicates)
        if (document.getElementById('tz-warning-overlay')) {
            return;
        }

        // Inject Modal HTML
        const overlay = document.createElement('div');
        overlay.id = 'tz-warning-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

        overlay.innerHTML = `
            <div style="background:white;border:2px solid black;box-shadow:6px 6px 0 black;padding:20px;max-width:300px;text-align:center;font-family:sans-serif;">
                <h3 style="margin-top:0;border-bottom:1px solid #ccc;padding-bottom:10px;">Timezone Not Set</h3>
                <p style="font-size:0.9rem;margin:15px 0;">Times may be incorrect. Please set your location in Settings.</p>
                <div style="display:flex;justify-content:center;gap:10px;">
                    <button id="tz-warn-dismiss" style="background:white;border:2px solid black;padding:8px 15px;font-weight:bold;cursor:pointer;box-shadow:2px 2px 0 black;">Dismiss</button>
                    <button id="tz-warn-settings" style="background:black;color:white;border:2px solid black;padding:8px 15px;font-weight:bold;cursor:pointer;box-shadow:2px 2px 0 black;">Settings</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('tz-warn-dismiss').onclick = function () {
            overlay.remove();
        };
        document.getElementById('tz-warn-settings').onclick = function () {
            window.location.href = 'settings';
        };
    }

    // Auto-run check when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkTimezoneOffset);
    } else {
        // DOM already loaded (e.g., script at bottom of page)
        checkTimezoneOffset();
    }

    // Timezone Exports
    window.rekindleGetGlobalTimeZone = getGlobalTimeZone;
    window.rekindleGetZonedDate = getZonedDate;
    window.rekindleGetDateInZone = getDateInZone;
    window.rekindleFormatTime = formatGlobalTime;
    window.rekindleFormatWallDate = formatWallDate;
    window.rekindleCheckTimezoneOffset = checkTimezoneOffset;

})();
