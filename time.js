(function () {
    // --- SHARED TIMEZONE HELPERS ---
    // Single source of truth for "Mixed Browser Timezone" fix

    // The location blob was read + JSON.parsed on every formatted timestamp
    // (feeds format several per row). Cache the parse, keyed on the raw string so
    // a settings change is still picked up.
    var _locRaw = null;
    var _locValue = null;
    var _locParsed = false;
    var _offsetRaw = null;
    var _offsetValue = null;
    var _offsetParsed = false;
    var _systemZone = null;

    function readManualLocation() {
        var raw = localStorage.getItem('rekindle_location_manual');
        if (_locParsed && raw === _locRaw) return _locValue;
        _locRaw = raw;
        _locParsed = true;
        _locValue = null;
        if (raw) {
            try { _locValue = JSON.parse(raw); } catch (e) { _locValue = null; }
        }
        return _locValue;
    }

    function readLegacyOffset() {
        var raw = localStorage.getItem('rekindle_timezone_offset');
        if (_offsetParsed && raw === _offsetRaw) return _offsetValue;
        _offsetRaw = raw;
        _offsetParsed = true;
        _offsetValue = null;
        if (raw) {
            var parsed = parseFloat(raw);
            _offsetValue = isNaN(parsed) ? null : parsed;
        }
        return _offsetValue;
    }

    window.rekindleInvalidateTimeCaches = function () {
        _locRaw = null; _locValue = null; _locParsed = false;
        _offsetRaw = null; _offsetValue = null; _offsetParsed = false;
        _systemZone = null;
    };

    function getGlobalTimeZone() {
        try {
            const globalLoc = readManualLocation();
            if (globalLoc && globalLoc.zone) return globalLoc.zone;
            if (_systemZone === null) {
                _systemZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
                    ? Intl.DateTimeFormat().resolvedOptions().timeZone
                    : 'UTC';
            }
            return _systemZone;
        } catch (e) {
            return 'UTC';
        }
    }

    // Lazy timezone prompt — shows once per page when local time is actually requested
    function maybeCheckTimezone() {
        if (window._rekindleTzPromptShown) return;
        window._rekindleTzPromptShown = true;
        setTimeout(function () {
            checkTimezoneOffset();
        }, 0);
    }

    function getDateInZone(date = new Date(), zone) {
        // PRIORITY: Check for robust Manual Offset (Automatic or User Set)
        // BUT ONLY if we are requesting the "Local" time or the "Manual Location's" time.
        // Otherwise, we break other timezones in Clocks app.
        // Lazy prompt: only trigger when requesting local/user time (no explicit zone)
        if (!zone) {
            maybeCheckTimezone();
        }
        const manualLoc = readManualLocation();
        let manualZone = null;
        let offsetHours = null;

        // Primary source: utc_offset inside rekindle_location_manual (backwards compatible)
        if (manualLoc) {
            manualZone = manualLoc.zone || null;
            if (typeof manualLoc.utc_offset === 'number') {
                offsetHours = manualLoc.utc_offset;
            }
        }

        // Fallback: separate rekindle_timezone_offset key (legacy)
        if (offsetHours === null) {
            offsetHours = readLegacyOffset();
        }

        const isTargetingUserZone = !zone || (manualZone && zone === manualZone);

        // If we have an explicit IANA zone string for the user's location, we can use Intl 
        // to handle Daylight Saving Time automatically (circumvents Kindle's broken system timezone issue).
        if (isTargetingUserZone && manualZone) {
            try {
                const options = {
                    timeZone: manualZone,
                    year: 'numeric', month: 'numeric', day: 'numeric',
                    hour: 'numeric', minute: 'numeric', second: 'numeric',
                    hour12: false
                };
                const s = date.toLocaleString('en-US', options);
                const [datePart, timePart] = s.split(', ');
                const [m, d, y] = datePart.split('/').map(Number);
                const [h, min, sec] = timePart.split(':').map(Number);
                if (!isNaN(y) && !isNaN(h)) {
                    return new Date(y, m - 1, d, h, min, sec);
                }
            } catch (e) {
                // If the zone string is unsupported by this browser version, fall back below.
            }
        }

        // STATIC FALLBACK: use manual UTC offset if Intl isn't an option (with manual DST switch support)
        if (offsetHours !== null && isTargetingUserZone) {
            if (!isNaN(offsetHours)) {
                let dstOffsetHours = localStorage.getItem('rekindle_dst_active') === 'true' ? 1 : 0;
                // Calculate wall clock components:
                // 1. Get UTC milliseconds from the input date
                const utcMs = date.getTime();
                // 2. Create a temp Date at the UTC time PLUS the offset
                const shifted = new Date(utcMs + ((offsetHours + dstOffsetHours) * 3600000));
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
        maybeCheckTimezone();
        return getDateInZone(date, getGlobalTimeZone());
    }

    // Format a date object (which acts as source timestamp) into a specific format string relative to Global Zone
    function formatGlobalTime(date, options = {}) {
        // Unified Logic: Convert to Wall Date first, then format "as is"
        // This ensures consistent behavior between calculations and display
        maybeCheckTimezone();
        const wallDate = getDateInZone(date);
        return formatWallDate(wallDate, options);
    }

    // Get the logical locale based on location settings
    function getUserLocale() {
        try {
            // Get language preference
            let lang = localStorage.getItem('rekindle_language');
            if (!lang || lang === 'auto') {
                if (document.documentElement && document.documentElement.lang) {
                    lang = document.documentElement.lang;
                } else if (typeof navigator !== 'undefined' && navigator.language) {
                    lang = navigator.language.split('-')[0];
                } else {
                    lang = 'en';
                }
            }

            // Get country code from location settings
            let country = null;
            const loc = readManualLocation();
            if (loc && loc.country_code) {
                country = loc.country_code.toUpperCase();
            }
            
            if (country) {
                return `${lang}-${country}`;
            } else {
                return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
            }
        } catch (e) {
            return 'en-US';
        }
    }

    // Format a "Wall Date" (a Date where .get*() methods return wall-clock values)
    function formatWallDate(wallDate, options = {}) {
        // Just format the Date's local representation - the Date was constructed
        // so that its local components match the desired wall-clock time
        const locale = getUserLocale();
        try {
            return wallDate.toLocaleString(locale, options);
        } catch (e) {
            try {
                return wallDate.toLocaleString('en-US', options);
            } catch (e2) {
                return wallDate.toString();
            }
        }
    }

    // --- TIMEZONE OFFSET WARNING ---
    // Displays a modal if the user has not configured their timezone offset.
    function checkTimezoneOffset() {
        // Never cover a sign-in screen with the timezone prompt; signing in
        // is how the user restores a saved timezone. The index login popup
        // opens via ?login=true, and this overlay would sit on top
        // of the modal. It is intentionally below .modal-overlay (10000).
        if (/\/(login)(\.html)?\/?$/.test(window.location.pathname || '')) return;
        try {
            if (sessionStorage.getItem('rekindle_tz_prompt_snoozed') === '1') return;
        } catch (e) { }
        try {
            if (new URLSearchParams(window.location.search).get('login') === 'true') return;
        } catch (e) { /* no URLSearchParams: fall through */ }

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

        // Inject Modal Styles
        const style = document.createElement('style');
        style.id = 'tz-modal-style';
        style.textContent = `
            :root {
                --stripe-pattern: repeating-linear-gradient(0deg, transparent, transparent 2px, #000 3px, #000 4px);
                --shadow: 4px 4px 0px #000000;
            }
            .tz-modal-window {
                background: white;
                border: 2px solid black;
                box-shadow: var(--shadow);
                width: 95%;
                max-width: 420px;
                display: flex;
                flex-direction: column;
                font-family: "Geneva", "Verdana", sans-serif;
            }
            .tz-modal-window .title-bar {
                height: 35px;
                border-bottom: 2px solid black;
                display: flex;
                align-items: center;
                justify-content: center;
                background: white;
                position: relative;
            }
            .tz-modal-window .title-stripes {
                position: absolute;
                top: 4px; bottom: 4px; left: 4px; right: 4px;
                background-image: var(--stripe-pattern);
                z-index: 0;
            }
            .tz-modal-window .title-text {
                background: white;
                padding: 0 15px;
                font-weight: bold;
                font-size: 1.1rem;
                z-index: 1;
                font-family: "Geneva", "Verdana", sans-serif;
                border: none;
                display: inline-flex;
                align-items: center;
                height: 100%;
                box-sizing: border-box;
            }
            .tz-modal-content { padding: 15px; text-align: center; }
            .tz-modal-content p { font-size: 0.9rem; margin: 0 0 15px 0; }
            .tz-modal-content input {
                width: 100%;
                border: 2px solid black;
                border-radius: 0;
                padding: 8px;
                font-family: inherit;
                box-sizing: border-box;
                font-size: 1rem;
                background: white;
            }
            #tz-search-results {
                max-height: 120px;
                overflow-y: auto;
                text-align: left;
                border: 2px solid black;
                margin-top: 5px;
                display: none;
                background: white;
            }
            .tz-result-item { padding: 8px; border-bottom: 1px solid #ccc; cursor: pointer; font-size: 0.9rem; }
            .tz-result-item:last-child { border-bottom: none; }
            #tz-search-status { font-size: 0.8rem; margin-top: 5px; min-height: 1.2em; }
            .tz-signin { margin-top: 14px; padding-top: 12px; border-top: 1px solid #ccc; }
            .tz-signin-btn {
                display: block;
                width: 100%;
                min-height: 48px;
                margin: 0;
                padding: 8px 12px;
                border: 2px solid black;
                border-radius: 0;
                background: white;
                color: black;
                box-shadow: 2px 2px 0 black;
                font-family: inherit;
                font-size: 0.9rem;
                font-weight: bold;
                text-align: center;
                cursor: pointer;
                box-sizing: border-box;
            }
            .tz-signin-btn:active {
                background: black;
                color: white;
                box-shadow: none;
                transform: translate(2px, 2px);
            }
            .tz-later-btn {
                display: block;
                width: 100%;
                min-height: 44px;
                margin: 8px 0 0 0;
                padding: 8px 12px;
                border: 2px solid black;
                border-radius: 0;
                background: #eee;
                color: black;
                box-shadow: 2px 2px 0 black;
                font-family: inherit;
                font-size: 0.85rem;
                font-weight: bold;
                text-align: center;
                cursor: pointer;
                box-sizing: border-box;
            }
            .tz-later-btn:active {
                background: black;
                color: white;
                box-shadow: none;
                transform: translate(2px, 2px);
            }
            .tz-signin-hint {
                font-size: 0.75rem;
                line-height: 1.35;
                color: #555;
                margin: 8px 0 0 0;
            }
        `;
        document.head.appendChild(style);

        // Inject Modal HTML
        const overlay = document.createElement('div');
        overlay.id = 'tz-warning-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;';

        overlay.innerHTML = `
            <div class="tz-modal-window">
                <div class="title-bar">
                    <div class="title-stripes"></div>
                    <span class="title-text" data-i18n="tz.title">Timezone Not Set</span>
                </div>
                <div class="tz-modal-content">
                    <p data-i18n="tz.desc">Times may be incorrect. Search for your city below:</p>
                    <input type="text" id="tz-city-search" placeholder="Search city..." autocomplete="off"
                        data-i18n-placeholder="tz.search_ph">
                    <div id="tz-search-results"></div>
                    <div id="tz-search-status"></div>
                    <div class="tz-signin">
                        <button type="button" class="tz-signin-btn" id="tz-signin-btn" data-i18n="tz.signin">Sign in instead</button>
                        <p class="tz-signin-hint" data-i18n="tz.signin_hint">Your saved timezone will be restored.</p>
                    </div>
                    <button type="button" class="tz-later-btn" id="tz-later-btn" data-i18n="tz.later">Later</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const searchInput = document.getElementById('tz-city-search');
        const resultsContainer = document.getElementById('tz-search-results');
        const statusLabel = document.getElementById('tz-search-status');
        let searchTimeout = null;

        function clearResults() {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
        }

        function showStatus(msg) {
            statusLabel.textContent = msg || '';
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function handleSearchInput(query) {
            clearTimeout(searchTimeout);
            clearResults();
            showStatus('');

            if (query.length < 2) {
                return;
            }

            resultsContainer.style.display = 'block';
            resultsContainer.innerHTML = '<div class="tz-result-item" style="color:#666;">Searching...</div>';

            searchTimeout = setTimeout(function () {
                fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=5&language=en&format=json')
                    .then(function (res) { return res.json(); })
                    .then(function (data) {
                        renderSearchResults(data.results || []);
                    })
                    .catch(function () {
                        resultsContainer.innerHTML = '<div class="tz-result-item" style="color:#666;">Error searching</div>';
                    });
            }, 500);
        }

        function renderSearchResults(results) {
            resultsContainer.innerHTML = '';
            if (results.length === 0) {
                resultsContainer.innerHTML = '<div class="tz-result-item">No results</div>';
                return;
            }

            results.forEach(function (city) {
                const div = document.createElement('div');
                div.className = 'tz-result-item';
                div.innerHTML = '<strong>' + escapeHtml(city.name) + '</strong> <small>' + escapeHtml(city.country || '') + '</small>';
                div.onclick = function () { selectCity(city); };
                resultsContainer.appendChild(div);
            });
        }

        function syncTimezoneToProfile(locData, offsetHours) {
            try {
                if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) return;
                if (!firebase.apps || !firebase.apps.length) return;
                var app = firebase.app();
                if (!app || !app.options || app.options.projectId !== 'rekindle-dd1fa') return;
                var user = firebase.auth().currentUser;
                if (!user) return;
                firebase.firestore().collection('users').doc(user.uid)
                    .collection('settings').doc('general').set({
                        manualLocation: locData,
                        timezoneOffset: offsetHours
                    }, { merge: true }).catch(function (e) {
                        console.warn('Timezone profile sync failed', e);
                    });
            } catch (e) {
                console.warn('Timezone profile sync unavailable', e);
            }
        }

        function selectCity(city) {
            searchInput.disabled = true;
            clearResults();
            showStatus('Getting timezone data...');

            fetch('https://api.open-meteo.com/v1/forecast?latitude=' + city.latitude + '&longitude=' + city.longitude + '&current_weather=true&timezone=auto')
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    const offsetSeconds = data.utc_offset_seconds;
                    const offsetHours = offsetSeconds / 3600;
                    console.log('Auto-Detected Offset:', offsetHours);
                    localStorage.setItem('rekindle_timezone_offset', offsetHours);

                    const locData = {
                        name: city.name || 'Unknown',
                        lat: city.latitude || 0,
                        lon: city.longitude || 0,
                        zone: city.timezone || null,
                        country_code: city.country_code || null,
                        utc_offset: offsetHours
                    };
                    localStorage.setItem('rekindle_location_manual', JSON.stringify(locData));
                    if (window.rekindleInvalidateTimeCaches) window.rekindleInvalidateTimeCaches();
                    syncTimezoneToProfile(locData, offsetHours);

                    showStatus('Timezone set to UTC' + (offsetHours >= 0 ? '+' : '') + offsetHours);
                    setTimeout(function () {
                        window.location.reload();
                    }, 800);
                })
                .catch(function (e) {
                    console.error('Timezone Fetch Error', e);
                    searchInput.disabled = false;
                    showStatus('Failed to fetch timezone. Try again.');
                });
        }

        searchInput.addEventListener('input', function () {
            handleSearchInput(this.value);
        });

        var tzLaterBtn = document.getElementById('tz-later-btn');
        if (tzLaterBtn) {
            tzLaterBtn.addEventListener('click', function () {
                try { sessionStorage.setItem('rekindle_tz_prompt_snoozed', '1'); } catch (e) { }
                dismissTimezonePrompt();
            });
        }

        var tzSignInBtn = document.getElementById('tz-signin-btn');
        if (tzSignInBtn) {
            tzSignInBtn.addEventListener('click', function () {
                // Canonical sign-in is the popup on the index page; login.html
                // is a diagnostics page and must not be a login destination.
                window.location.href = 'index?login=true';
            });
        }

        // Dismiss button removed — the user can set a timezone or sign in.
    }

    // --- TIMEZONE PROFILE RESTORE ---
    // After sign-in, pull the account's saved settings/general.manualLocation
    // into localStorage so the timezone prompt does not reappear on the next
    // page. Mirrors login.html's restoreTimezone() — keep the two in sync.
    function dismissTimezonePrompt() {
        var overlay = document.getElementById('tz-warning-overlay');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        var style = document.getElementById('tz-modal-style');
        if (style && style.parentNode) style.parentNode.removeChild(style);
    }

    function restoreTimezoneFromProfile(user, done) {
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            if (done) done();
        }
        setTimeout(finish, 2500);
        try {
            if (!user) { finish(); return; }
            if (typeof firebase === 'undefined' || !firebase.firestore) { finish(); return; }
            if (!firebase.apps || !firebase.apps.length) { finish(); return; }
            var app = firebase.app();
            if (!app || !app.options || app.options.projectId !== 'rekindle-dd1fa') { finish(); return; }
            firebase.firestore().collection('users').doc(user.uid)
                .collection('settings').doc('general').get()
                .then(function (doc) {
                    var applied = false;
                    if (doc.exists) {
                        var data = doc.data();
                        if (data.manualLocation) {
                            localStorage.setItem('rekindle_location_manual', JSON.stringify(data.manualLocation));
                            if (typeof data.manualLocation.utc_offset === 'number') {
                                localStorage.setItem('rekindle_timezone_offset', data.manualLocation.utc_offset);
                                applied = true;
                            }
                        }
                        if (typeof data.timezoneOffset === 'number') {
                            localStorage.setItem('rekindle_timezone_offset', data.timezoneOffset);
                            applied = true;
                        }
                    }
                    if (applied) dismissTimezonePrompt();
                    finish();
                })
                .catch(function (e) {
                    console.warn('Timezone restore failed', e);
                    finish();
                });
        } catch (e) {
            console.warn('Timezone restore unavailable', e);
            finish();
        }
    }

    // NOTE: checkTimezoneOffset() is no longer auto-run.
    // Call window.rekindleCheckTimezoneOffset() manually on pages that need it.

    // --- DAYLIGHT SAVING COMPONENT ---
    // Injects a UI toggle to enable/disable Daylight Saving Time (+1 hr)
    function renderDSTToggle(parentElement) {
        const container = document.createElement('div');
        container.style.cssText = 'display:flex; align-items:center; margin-top:10px; font-family:"Geneva","Verdana",sans-serif;';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'rekindle-dst-toggle';
        checkbox.checked = localStorage.getItem('rekindle_dst_active') === 'true';
        
        const label = document.createElement('label');
        label.htmlFor = 'rekindle-dst-toggle';
        label.innerText = (window.t ? window.t('time.dst_active', 'Daylight Saving Time (+1 hr)') : 'Daylight Saving Time (+1 hr)');
        
        checkbox.addEventListener('change', function() {
            localStorage.setItem('rekindle_dst_active', this.checked);
            document.dispatchEvent(new Event('rekindle:time:dst_changed'));
            // If the user is on a page that needs immediate refresh, they can listen to this event.
        });
        
        container.appendChild(checkbox);
        container.appendChild(label);
        label.style.marginLeft = '10px';
        
        if (parentElement) {
            parentElement.appendChild(container);
        }
        return container;
    }

    // Timezone Exports
    window.rekindleGetGlobalTimeZone = getGlobalTimeZone;
    window.rekindleGetZonedDate = getZonedDate;
    window.rekindleGetDateInZone = getDateInZone;
    window.rekindleFormatTime = formatGlobalTime;
    window.rekindleFormatWallDate = formatWallDate;
    window.rekindleGetUserLocale = getUserLocale;
    window.rekindleCheckTimezoneOffset = checkTimezoneOffset;
    window.rekindleRestoreTimezoneFromProfile = restoreTimezoneFromProfile;
    window.rekindleRenderDSTToggle = renderDSTToggle;

})();
