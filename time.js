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

    function getZonedDate(date = new Date()) {
        const zone = getGlobalTimeZone();
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

    // Format a date object (which acts as source timestamp) into a specific format string relative to Global Zone
    function formatGlobalTime(date, options = {}) {
        const zone = getGlobalTimeZone();
        try {
            return date.toLocaleString('en-US', { ...options, timeZone: zone });
        } catch (e) {
            return date.toLocaleString('en-US', options);
        }
    }

    // Timezone Exports
    window.rekindleGetGlobalTimeZone = getGlobalTimeZone;
    window.rekindleGetZonedDate = getZonedDate;
    window.rekindleFormatTime = formatGlobalTime;

})();
