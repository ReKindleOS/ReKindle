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

    // --- TIMEZONE / LANGUAGE PROMPT ---
    // One System 7 dialog serves two jobs:
    //   1. No saved timezone: search a city, then confirm the language that most
    //      people in that region speak (pre-selected from the registry).
    //   2. Timezone saved, but the user never explicitly picked a language:
    //      offer the language picker once per device (the 2026-11 language
    //      batch), so existing users notice the new locales.
    // Both paths write localStorage and mirror the language to
    // users/{uid}/privateSettings/preferences.language, the same field
    // settings.html saveLanguage() uses.

    var LANGUAGE_PROMPT_SEEN_KEY = 'rekindle_language_prompt_v1';
    // Same mark as the dashboard info modal (logo.svg). keep-white stops the
    // dark-mode image re-inversion, so it stays visible on the black window.
    var TZ_LOGO_HTML = '<img class="tz-icon tz-logo keep-white" src="logo.svg" width="44" height="44" alt="">';

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function hasSavedTimezone() {
        const manualLocStr = localStorage.getItem('rekindle_location_manual');
        if (manualLocStr) {
            try {
                const loc = JSON.parse(manualLocStr);
                if (typeof loc.utc_offset === 'number') return true;
            } catch (e) { }
        }
        const offsetStr = localStorage.getItem('rekindle_timezone_offset');
        return offsetStr !== null && offsetStr !== '';
    }

    function storedLanguageChoice() {
        try {
            var stored = localStorage.getItem('rekindle_language');
            if (!stored || stored === 'auto') return '';
            var reg = window.rekindleLanguages;
            var code = reg && reg.normalize ? reg.normalize(stored) : String(stored).toLowerCase().split('-')[0];
            if (reg && typeof reg.isShipped === 'function' && !reg.isShipped(code)) return '';
            return code || '';
        } catch (e) {
            return '';
        }
    }

    function languagePromptAlreadySeen() {
        try { return localStorage.getItem(LANGUAGE_PROMPT_SEEN_KEY) === '1'; } catch (e) { return false; }
    }

    function markLanguagePromptSeen() {
        try { localStorage.setItem(LANGUAGE_PROMPT_SEEN_KEY, '1'); } catch (e) { }
    }

    // index.html writes rekindle_uid on sign-in and removes it on logout, so it
    // is the fallback signal on the six pages that do not load Firebase Auth.
    function likelySignedIn() {
        try {
            if (localStorage.getItem('rekindle_uid')) return true;
        } catch (e) { }
        try {
            if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) return true;
        } catch (e) { }
        return false;
    }

    // "Continue as guest" is remembered for the tab, so the sign-in step is not
    // repeated on every page while the user has still not set a timezone.
    function guestChosenThisSession() {
        try { return sessionStorage.getItem('rekindle_tz_guest') === '1'; } catch (e) { return false; }
    }

    function snoozeTzPrompt() {
        try { sessionStorage.setItem('rekindle_tz_prompt_snoozed', '1'); } catch (e) { }
    }

    function goToLanguageRequest() {
        // The user has answered this prompt; do not show it again over the
        // Suggestions form they are about to fill in. Reuse the board so auth,
        // moderation and duplicate detection stay in one place.
        markLanguagePromptSeen();
        snoozeTzPrompt();
        window.location.href = 'suggestions.html?new=translation';
    }

    // js/i18n.js owns the language registry, and some pages load it after
    // time.js. The prompt is built lazily, but wait briefly so the picker and
    // the country suggestion are never missing.
    function withLanguageRegistry(callback) {
        var tries = 0;
        (function wait() {
            if (window.rekindleLanguages || tries >= 40) { callback(); return; }
            tries += 1;
            setTimeout(wait, 50);
        })();
    }

    // Save an explicit language choice. Mirrors settings.html saveLanguage():
    // localStorage always, privateSettings/preferences.language when signed in.
    function persistLanguageChoice(code, done) {
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            if (done) done();
        }
        try { localStorage.setItem('rekindle_language', code); } catch (e) { }
        setTimeout(finish, 1600);
        try {
            if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) { finish(); return; }
            if (!firebase.apps || !firebase.apps.length) { finish(); return; }
            var app = firebase.app();
            if (!app || !app.options || app.options.projectId !== 'rekindle-dd1fa') { finish(); return; }
            var user = firebase.auth().currentUser;
            if (!user) { finish(); return; }
            firebase.firestore().collection('users').doc(user.uid)
                .collection('privateSettings').doc('preferences')
                .set({ language: code }, { merge: true })
                .then(finish, finish);
        } catch (e) {
            finish();
        }
    }

    // Displays the timezone prompt, or the language-only prompt for users who
    // already have a timezone but never explicitly chose a language.
    function checkTimezoneOffset() {
        // Never cover a sign-in screen with this prompt; signing in is how the
        // user restores a saved timezone. The index login popup opens via
        // ?login=true, and this overlay would sit on top of that modal. It is
        // intentionally below .modal-overlay (10000).
        if (/\/(login)(\.html)?\/?$/.test(window.location.pathname || '')) return;
        try {
            if (new URLSearchParams(window.location.search).get('login') === 'true') return;
        } catch (e) { /* no URLSearchParams: fall through */ }

        if (!hasSavedTimezone()) {
            try {
                if (sessionStorage.getItem('rekindle_tz_prompt_snoozed') === '1') return;
            } catch (e) { }
            if (document.getElementById('tz-warning-overlay')) return;
            withLanguageRegistry(function () {
                if (document.getElementById('tz-warning-overlay')) return;
                showTzPrompt('timezone');
            });
            return;
        }

        // Timezone already set. Only people who never explicitly picked a
        // language see the picker, and only once per device. settings.html has
        // the real dropdown, so do not nag there.
        if (storedLanguageChoice() || languagePromptAlreadySeen()) return;
        if (document.getElementById('language-select')) return;
        if (document.getElementById('tz-warning-overlay')) return;
        withLanguageRegistry(function () {
            if (document.getElementById('tz-warning-overlay')) return;
            showTzPrompt('language');
        });
    }

    function showTzPrompt(mode) {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', function () {
                if (!document.getElementById('tz-warning-overlay')) showTzPrompt(mode);
            });
            return;
        }
        var isLanguageOnly = mode === 'language';

        // Inject Modal Styles (scoped by id: host pages define their own
        // .window/.title-bar rules, so nothing may leak either way).
        var style = document.getElementById('tz-modal-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'tz-modal-style';
            style.textContent = `
                #tz-warning-overlay {
                    position: fixed;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: rgba(0, 0, 0, 0.55);
                    z-index: 9000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 10px;
                    box-sizing: border-box;
                    font-family: "Geneva", "Verdana", sans-serif;
                    color: #000;
                }
                #tz-warning-overlay .tz-window {
                    width: 100%;
                    max-width: 430px;
                    max-height: 94vh;
                    display: flex;
                    flex-direction: column;
                    background: #fff;
                    color: #000;
                    border: 2px solid #000;
                    box-shadow: 5px 5px 0 #000;
                    box-sizing: border-box;
                    text-align: start;
                }
                #tz-warning-overlay .tz-titlebar {
                    position: relative;
                    flex: none;
                    height: 34px;
                    border-bottom: 2px solid #000;
                    background: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #tz-warning-overlay .tz-stripes {
                    position: absolute;
                    top: 4px; bottom: 4px; left: 4px; right: 4px;
                    background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, #000 3px, #000 4px);
                }
                #tz-warning-overlay .tz-title {
                    position: relative;
                    z-index: 1;
                    max-width: 82%;
                    padding: 0 14px;
                    background: #fff;
                    font-size: 1rem;
                    font-weight: bold;
                    line-height: 32px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    box-sizing: border-box;
                }
                #tz-warning-overlay .tz-body {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                    -webkit-overflow-scrolling: touch;
                    padding: 14px;
                }
                #tz-warning-overlay .tz-hero {
                    display: flex;
                    align-items: flex-start;
                    margin-bottom: 14px;
                }
                #tz-warning-overlay .tz-icon {
                    flex: none;
                    display: block;
                    width: 44px;
                    height: 44px;
                    margin-right: 10px;
                }
                #tz-warning-overlay .tz-logo {
                    width: 44px;
                    height: 44px;
                    image-rendering: auto;
                }
                #tz-warning-overlay .tz-benefits {
                    margin: 12px 0 0 0;
                    padding-left: 18px;
                    list-style: square outside;
                    font-size: 0.78rem;
                    line-height: 1.4;
                }
                #tz-warning-overlay .tz-benefits li {
                    margin: 0 0 6px 0;
                }
                #tz-warning-overlay .tz-benefits li:last-child { margin-bottom: 0; }
                #tz-warning-overlay .tz-benefits li.tz-benefit-plus { font-style: italic; }
                #tz-warning-overlay .tz-window[dir="rtl"] .tz-benefits {
                    padding-left: 0;
                    padding-right: 18px;
                }
                #tz-warning-overlay .tz-lead {
                    margin: 0;
                    padding-top: 2px;
                    font-size: 0.86rem;
                    line-height: 1.4;
                }
                #tz-warning-overlay .tz-section {
                    margin-top: 12px;
                    padding-top: 10px;
                    border-top: 1px dotted #999;
                }
                #tz-warning-overlay .tz-label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 0.7rem;
                    font-weight: bold;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                }
                #tz-warning-overlay .tz-select,
                #tz-warning-overlay input[type="text"] {
                    display: block;
                    width: 100%;
                    min-height: 44px;
                    padding: 8px 10px;
                    border: 2px solid #000;
                    border-radius: 0;
                    background: #fff;
                    color: #000;
                    font-family: inherit;
                    font-size: 0.95rem;
                    box-sizing: border-box;
                }
                #tz-warning-overlay .tz-select {
                    text-overflow: ellipsis;
                }
                #tz-warning-overlay .tz-hint {
                    margin: 6px 0 0 0;
                    font-size: 0.75rem;
                    line-height: 1.35;
                    color: #444;
                }
                #tz-warning-overlay .tz-hint:empty { display: none; }
                #tz-warning-overlay .tz-signin-hint { margin-top: 10px; color: #555; }
                #tz-warning-overlay .tz-results {
                    display: none;
                    max-height: 240px;
                    margin-top: 6px;
                    overflow-y: auto;
                    border: 2px solid #000;
                    background: #fff;
                }
                #tz-warning-overlay .tz-result {
                    min-height: 48px;
                    padding: 12px 10px;
                    border-bottom: 1px solid #ccc;
                    font-size: 0.85rem;
                    line-height: 1.3;
                    text-align: start;
                    cursor: pointer;
                    box-sizing: border-box;
                }
                #tz-warning-overlay .tz-result:last-child { border-bottom: none; }
                #tz-warning-overlay .tz-result strong { font-weight: bold; }
                #tz-warning-overlay .tz-result small { color: #555; font-size: 0.78rem; }
                #tz-warning-overlay .tz-result:active { background: #000; color: #fff; }
                #tz-warning-overlay .tz-result:active small { color: #ddd; }
                #tz-warning-overlay .tz-status {
                    margin-top: 8px;
                    font-size: 0.75rem;
                    line-height: 1.35;
                }
                #tz-warning-overlay .tz-status:empty { display: none; }
                #tz-warning-overlay .tz-selected {
                    display: none;
                    margin-top: 8px;
                    padding: 7px 9px;
                    border: 2px solid #000;
                    border-left-width: 8px;
                    border-inline-start-width: 8px;
                    font-size: 0.85rem;
                    font-weight: bold;
                    line-height: 1.3;
                }
                #tz-warning-overlay .tz-actions {
                    display: flex;
                    flex-direction: column;
                    margin-top: 12px;
                }
                #tz-warning-overlay .tz-btn {
                    display: block;
                    width: 100%;
                    min-height: 48px;
                    margin: 0;
                    padding: 9px 12px;
                    border: 2px solid #000;
                    border-radius: 0;
                    font-family: inherit;
                    font-size: 0.92rem;
                    font-weight: bold;
                    text-align: center;
                    cursor: pointer;
                    box-sizing: border-box;
                }
                #tz-warning-overlay .tz-btn-primary {
                    background: #000;
                    color: #fff;
                }
                #tz-warning-overlay .tz-btn-primary:active {
                    background: #fff;
                    color: #000;
                    transform: translate(2px, 2px);
                }
                #tz-warning-overlay .tz-btn-primary[disabled] {
                    background: #fff;
                    color: #777;
                    border-color: #777;
                    cursor: default;
                }
                #tz-warning-overlay .tz-btn-secondary {
                    margin-top: 9px;
                    background: #fff;
                    color: #000;
                    box-shadow: 2px 2px 0 #000;
                }
                #tz-warning-overlay .tz-btn-secondary:active {
                    background: #000;
                    color: #fff;
                    box-shadow: none;
                    transform: translate(2px, 2px);
                }
                #tz-warning-overlay .tz-footer {
                    flex: none;
                    padding: 10px 14px;
                    border-top: 1px solid #999;
                    background: #f4f4f4;
                    font-size: 0.72rem;
                    line-height: 1.4;
                    color: #333;
                }
                #tz-warning-overlay .tz-footer p { margin: 0; }
                #tz-warning-overlay .tz-footer p + p { margin-top: 5px; }
                #tz-warning-overlay .tz-signin-hint { color: #555; }
                #tz-warning-overlay .tz-link {
                    display: inline;
                    padding: 0;
                    margin: 0;
                    border: none;
                    background: none;
                    font-family: inherit;
                    font-size: 0.75rem;
                    font-weight: bold;
                    color: #000;
                    text-decoration: underline;
                    cursor: pointer;
                }
                #tz-warning-overlay .tz-link:active { background: #000; color: #fff; }
                #tz-warning-overlay .tz-window[dir="rtl"] .tz-selected {
                    border-left-width: 2px;
                    border-right-width: 8px;
                }
            `;
            document.head.appendChild(style);
        }

        // Sign-in first (unless this device already knows the user or they
        // chose "Continue as guest" earlier in the tab), then the timezone and
        // language setup. One window, two steps, so Back keeps the state.
        var signedIn = likelySignedIn();
        var hasSignInStep = !isLanguageOnly && !signedIn;
        var startOnSignIn = hasSignInStep && !guestChosenThisSession();

        var titleHtml = '';
        if (hasSignInStep) {
            titleHtml += '<span class="tz-title" id="tz-title-signin" data-i18n="tz.signin_title"' +
                (startOnSignIn ? '' : ' style="display:none"') + '>Sign In</span>';
        }
        titleHtml += '<span class="tz-title" id="tz-title-main" data-i18n="' +
            (isLanguageOnly ? 'tz.lang_title' : 'tz.title') + '"' +
            (startOnSignIn ? ' style="display:none"' : '') + '>' +
            (isLanguageOnly ? 'Choose Your Language' : 'Timezone Not Set') +
            '</span>';

        var signinSection = '';
        if (hasSignInStep) {
            signinSection =
                '<div class="tz-body" id="tz-step-signin"' + (startOnSignIn ? '' : ' style="display:none"') + '>' +
                    '<div class="tz-hero">' +
                        TZ_LOGO_HTML +
                        '<p class="tz-lead" data-i18n="tz.signin_desc">' +
                            'Sign in to sync your apps and data across every device. Or continue as a guest.' +
                        '</p>' +
                    '</div>' +
                    '<ul class="tz-benefits">' +
                        '<li data-i18n="tz.benefit_sync">Free cloud sync: notes, journal, lists, reading history, settings and more.</li>' +
                        '<li data-i18n="tz.benefit_data">No data loss: your data lives in your account, so a cache wipe or a new device won\'t erase it.</li>' +
                        '<li data-i18n="tz.benefit_social">Community: post in KindleChat, Neighbourhood and Topics.</li>' +
                        '<li class="tz-benefit-plus" data-i18n="tz.benefit_plus">ReKindle+ is optional: extra apps, cloud storage and AI if you subscribe — sync works without it.</li>' +
                    '</ul>' +
                    '<div class="tz-actions">' +
                        '<button type="button" class="tz-btn tz-btn-primary" id="tz-login-btn" data-i18n="tz.signin_btn">Sign In</button>' +
                        '<button type="button" class="tz-btn tz-btn-secondary" id="tz-guest-btn" data-i18n="tz.guest">Continue as guest</button>' +
                    '</div>' +
                    '<p class="tz-hint tz-signin-hint" data-i18n="tz.signin_hint">Your saved timezone will be restored.</p>' +
                '</div>' +
                '<div class="tz-footer" id="tz-footer-signin"' + (startOnSignIn ? '' : ' style="display:none"') + '>' +
                    '<p><button type="button" class="tz-link" id="tz-later-signin-btn" data-i18n="tz.later">Later</button></p>' +
                    '<p><button type="button" class="tz-link" id="tz-request-signin-btn" data-i18n="tz.request_lang">My language is not supported</button></p>' +
                '</div>';
        }

        var mainBody =
            '<div class="tz-hero">' +
                TZ_LOGO_HTML +
                '<p class="tz-lead" data-i18n="' + (isLanguageOnly ? 'tz.lang_desc' : 'tz.desc') + '">' +
                    (isLanguageOnly
                        ? 'ReKindle speaks more languages now. Pick the one you would like to use.'
                        : 'Times may be incorrect. Search for your city below:') +
                '</p>' +
            '</div>' +
            '<div class="tz-section">' +
                '<label class="tz-label" for="tz-language" data-i18n="settings.language">Language</label>' +
                '<select id="tz-language" class="tz-select no-custom-select"></select>' +
                '<p class="tz-hint" id="tz-language-hint" aria-live="polite"></p>' +
            '</div>' +
            (isLanguageOnly ? '' :
                '<div class="tz-section">' +
                    '<label class="tz-label" for="tz-city-search" data-i18n="tz.city">City</label>' +
                    '<input type="text" id="tz-city-search" placeholder="Search city..." autocomplete="off" data-i18n-placeholder="tz.search_ph">' +
                    '<div class="tz-results" id="tz-search-results"></div>' +
                    '<div class="tz-selected" id="tz-selected-city"></div>' +
                '</div>') +
            '<div class="tz-status" id="tz-status" aria-live="polite"></div>' +
            '<div class="tz-actions">' +
                '<button type="button" class="tz-btn tz-btn-primary" id="tz-primary-btn"' +
                    (isLanguageOnly ? '' : ' disabled') +
                    ' data-i18n="' + (isLanguageOnly ? 'tz.continue' : 'tz.save_city') + '">' +
                    (isLanguageOnly ? 'Continue' : 'Use this city') +
                '</button>' +
                '<button type="button" class="tz-btn tz-btn-secondary" id="tz-secondary-btn" ' +
                    'data-i18n="' + (isLanguageOnly ? 'tz.not_now' : 'tz.later') + '">' +
                    (isLanguageOnly ? 'Not now' : 'Later') +
                '</button>' +
            '</div>';

        var mainFooter =
            '<div class="tz-footer" id="tz-footer-main"' + (startOnSignIn ? ' style="display:none"' : '') + '>' +
                (hasSignInStep
                    ? '<p id="tz-back-line"><button type="button" class="tz-link" id="tz-back-btn" data-i18n="common.back">Back</button></p>'
                    : '') +
                '<p><button type="button" class="tz-link" id="tz-request-btn" data-i18n="tz.request_lang">My language is not supported</button></p>' +
            '</div>';

        var overlay = document.createElement('div');
        overlay.id = 'tz-warning-overlay';
        overlay.className = 'rk-dark-scrim';
        overlay.innerHTML =
            '<div class="tz-window" role="dialog" aria-modal="true" aria-labelledby="' +
                (startOnSignIn ? 'tz-title-signin' : 'tz-title-main') + '">' +
                '<div class="tz-titlebar">' +
                    '<div class="tz-stripes"></div>' +
                    titleHtml +
                '</div>' +
                signinSection +
                '<div class="tz-body" id="tz-step-timezone"' + (startOnSignIn ? ' style="display:none"' : '') + '>' +
                    mainBody +
                '</div>' +
                mainFooter +
            '</div>';

        document.body.appendChild(overlay);

        // --- Modal state -------------------------------------------------
        var currentLangCode = (function () {
            var reg = window.rekindleLanguages;
            if (reg && typeof reg.current === 'function') {
                try { return reg.current(); } catch (e) { }
            }
            var htmlLang = document.documentElement && document.documentElement.lang;
            if (htmlLang) return String(htmlLang).split('-')[0] || 'en';
            return 'en';
        })();
        var deviceLang = (function () {
            try {
                var raw = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '';
                var reg = window.rekindleLanguages;
                var code = reg && reg.normalize ? reg.normalize(raw) : String(raw).toLowerCase().split('-')[0];
                if (code && reg && typeof reg.isShipped === 'function' && reg.isShipped(code)) return code;
            } catch (e) { }
            return '';
        })();
        var suggestedCode = '';
        var suggestionSource = ''; // 'region' | 'device' | 'current'
        var languageTouched = false;
        var selectedCity = null;
        var statusSpec = null;
        var previewDict = null;
        var previewCode = '';
        var previewSeq = 0;

        var win = overlay.querySelector('.tz-window');
        var languageSelect = document.getElementById('tz-language');
        var languageHint = document.getElementById('tz-language-hint');
        var statusLabel = document.getElementById('tz-status');
        var primaryBtn = document.getElementById('tz-primary-btn');
        var secondaryBtn = document.getElementById('tz-secondary-btn');
        var searchInput = document.getElementById('tz-city-search');
        var resultsContainer = document.getElementById('tz-search-results');
        var selectedLabel = document.getElementById('tz-selected-city');
        var loginBtn = document.getElementById('tz-login-btn');
        var guestBtn = document.getElementById('tz-guest-btn');
        var laterSigninBtn = document.getElementById('tz-later-signin-btn');
        var requestSigninBtn = document.getElementById('tz-request-signin-btn');
        var backBtn = document.getElementById('tz-back-btn');
        var currentStep = startOnSignIn ? 'signin' : 'main';

        function showStep(step) {
            if (isLanguageOnly) return;
            var signinBodyEl = document.getElementById('tz-step-signin');
            var signinFooterEl = document.getElementById('tz-footer-signin');
            var signinTitleEl = document.getElementById('tz-title-signin');
            var mainBodyEl = document.getElementById('tz-step-timezone');
            var mainFooterEl = document.getElementById('tz-footer-main');
            var mainTitleEl = document.getElementById('tz-title-main');
            if (!mainBodyEl) return;
            var onSignIn = step === 'signin';
            currentStep = onSignIn ? 'signin' : 'main';
            if (signinBodyEl) signinBodyEl.style.display = onSignIn ? '' : 'none';
            if (signinFooterEl) signinFooterEl.style.display = onSignIn ? '' : 'none';
            if (signinTitleEl) signinTitleEl.style.display = onSignIn ? '' : 'none';
            mainBodyEl.style.display = onSignIn ? 'none' : '';
            if (mainFooterEl) mainFooterEl.style.display = onSignIn ? 'none' : '';
            if (mainTitleEl) mainTitleEl.style.display = onSignIn ? 'none' : '';
            win.setAttribute('aria-labelledby', onSignIn ? 'tz-title-signin' : 'tz-title-main');
            var scroller = onSignIn ? signinBodyEl : mainBodyEl;
            if (scroller) scroller.scrollTop = 0;
        }

        // Capture the English copy so a live locale preview can be reverted
        // per key (host translations are applied by js/i18n.js before this).
        var textNodes = [];
        var placeholderNodes = [];
        (function captureStatic() {
            var els = overlay.querySelectorAll('[data-i18n]');
            for (var i = 0; i < els.length; i++) {
                textNodes.push({ el: els[i], key: els[i].getAttribute('data-i18n'), text: els[i].textContent });
            }
            var phs = overlay.querySelectorAll('[data-i18n-placeholder]');
            for (var j = 0; j < phs.length; j++) {
                placeholderNodes.push({
                    el: phs[j],
                    key: phs[j].getAttribute('data-i18n-placeholder'),
                    text: phs[j].getAttribute('placeholder') || ''
                });
            }
        })();

        function tzText(key, fallback, vars) {
            var text = (previewDict && previewDict[key]) ? previewDict[key] : '';
            if (!text) {
                if (vars && typeof window.tFormat === 'function') return window.tFormat(key, vars, fallback);
                if (typeof window.t === 'function') return window.t(key, fallback);
                return fallback;
            }
            if (vars) {
                for (var name in vars) {
                    if (Object.prototype.hasOwnProperty.call(vars, name)) {
                        text = text.split('${' + name + '}').join(String(vars[name]));
                    }
                }
            }
            return text;
        }

        function languageName(code) {
            var reg = window.rekindleLanguages;
            var meta = (reg && typeof reg.get === 'function') ? reg.get(code) : null;
            return meta ? meta.native : code;
        }

        function regionLanguageFor(countryCode) {
            var reg = window.rekindleLanguages;
            if (!countryCode || !reg) return '';
            if (typeof reg.popularLanguage === 'function') return reg.popularLanguage(countryCode) || '';
            if (typeof reg.countryLanguage === 'function') return reg.countryLanguage(countryCode) || '';
            return '';
        }

        function applyStaticText() {
            for (var i = 0; i < textNodes.length; i++) {
                var node = textNodes[i];
                var value = previewDict && previewDict[node.key];
                node.el.textContent = value || node.text;
            }
            for (var j = 0; j < placeholderNodes.length; j++) {
                var ph = placeholderNodes[j];
                var phValue = previewDict && previewDict[ph.key];
                ph.el.setAttribute('placeholder', phValue || ph.text);
            }
        }

        function renderStatus() {
            statusLabel.textContent = statusSpec
                ? tzText(statusSpec.key, statusSpec.fallback, statusSpec.vars)
                : '';
        }

        function setStatus(spec) {
            statusSpec = spec || null;
            renderStatus();
        }

        function updateLanguageHint() {
            var parts = [];
            if (suggestionSource === 'region' && suggestedCode) {
                parts.push(tzText('tz.lang_region', 'Most people in your region use ${language}.', {
                    language: languageName(suggestedCode)
                }));
            }
            if (suggestionSource === 'region' && deviceLang && deviceLang !== suggestedCode) {
                parts.push(tzText('tz.lang_device', 'Your device language is ${language}.', {
                    language: languageName(deviceLang)
                }));
            }
            languageHint.textContent = parts.join(' ');
        }

        function applyPreview(dict, code) {
            previewDict = dict || {};
            previewCode = code;
            var reg = window.rekindleLanguages;
            var dir = (reg && typeof reg.direction === 'function') ? reg.direction(code) : 'ltr';
            win.setAttribute('dir', dir === 'rtl' ? 'rtl' : 'ltr');
            applyStaticText();
            updateLanguageHint();
            renderStatus();
        }

        function previewLanguage(code) {
            var seq = ++previewSeq;
            if (code === currentLangCode) {
                // Use the locale this page already loaded instead of re-fetching.
                var current = window.rekindleTranslations || {};
                applyPreview(current, code);
                return;
            }
            if (code === 'en') {
                applyPreview({}, code);
                return;
            }
            fetch('locales/' + code + '.json')
                .then(function (res) { return res.ok ? res.json() : {}; })
                .then(function (dict) {
                    if (seq !== previewSeq || !document.body.contains(overlay)) return;
                    applyPreview(dict || {}, code);
                })
                .catch(function () {
                    if (seq !== previewSeq) return;
                    applyPreview({}, code);
                });
        }

        function populateLanguages() {
            var reg = window.rekindleLanguages;
            var list = [];
            if (reg && typeof reg.shippedLanguages === 'function') {
                list = reg.shippedLanguages().slice();
            }
            if (!list.length) list = [{ code: 'en', native: 'English', dir: 'ltr' }];
            list.sort(function (a, b) {
                return String(a.native).localeCompare(String(b.native));
            });

            var explicit = storedLanguageChoice();
            var region = '';
            try {
                var loc = readManualLocation();
                if (loc && loc.country_code) region = regionLanguageFor(loc.country_code);
            } catch (e) { }

            if (explicit) {
                // An explicit choice always wins; a location change must not
                // silently switch the user's language.
                suggestedCode = explicit;
                suggestionSource = 'current';
                languageTouched = true;
            } else if (region) {
                suggestedCode = region;
                suggestionSource = 'region';
            } else if (deviceLang) {
                suggestedCode = deviceLang;
                suggestionSource = 'device';
            } else {
                suggestedCode = currentLangCode;
                suggestionSource = 'current';
            }

            var seen = {};
            function addOption(code) {
                if (!code) return;
                var normalized = reg && reg.normalize ? reg.normalize(code) : code;
                if (seen[normalized]) return;
                var meta = (reg && typeof reg.get === 'function') ? reg.get(code) : null;
                if (!meta) return;
                var option = document.createElement('option');
                option.value = meta.code;
                option.textContent = meta.native;
                languageSelect.appendChild(option);
                seen[normalized] = true;
            }
            addOption(suggestedCode);
            addOption(deviceLang);
            addOption(currentLangCode);
            for (var i = 0; i < list.length; i++) addOption(list[i].code);
            languageSelect.value = suggestedCode;
            updateLanguageHint();
        }

        function clearResults() {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
        }

        function resetSelection() {
            selectedCity = null;
            if (selectedLabel) {
                selectedLabel.style.display = 'none';
                selectedLabel.textContent = '';
            }
            if (primaryBtn && !isLanguageOnly) primaryBtn.disabled = true;
        }

        function renderSearchResults(results) {
            resultsContainer.innerHTML = '';
            if (!results.length) {
                resultsContainer.style.display = 'none';
                setStatus({ key: 'tz.no_results', fallback: 'No results' });
                return;
            }
            results.forEach(function (city) {
                var div = document.createElement('div');
                div.className = 'tz-result';
                var sub = [];
                if (city.admin1 && city.admin1 !== city.name) sub.push(city.admin1);
                if (city.country) sub.push(city.country);
                div.innerHTML = '<strong>' + escapeHtml(city.name) + '</strong>' +
                    (sub.length ? ' <small>' + escapeHtml(sub.join(', ')) + '</small>' : '');
                div.onclick = function () { applyCity(city); };
                resultsContainer.appendChild(div);
            });
            resultsContainer.style.display = 'block';
            setStatus(null);
        }

        var searchTimeout = null;
        var searchSeq = 0;

        function handleSearchInput(query) {
            clearTimeout(searchTimeout);
            var seq = ++searchSeq;
            resetSelection();
            if (query.length < 2) {
                clearResults();
                setStatus(null);
                return;
            }
            resultsContainer.innerHTML = '';
            setStatus({ key: 'clocks.modal.add.searching', fallback: 'Searching...' });

            searchTimeout = setTimeout(function () {
                fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) +
                    '&count=5&language=en&format=json')
                    .then(function (res) { return res.json(); })
                    .then(function (data) {
                        if (seq !== searchSeq) return;
                        renderSearchResults((data && data.results) || []);
                    })
                    .catch(function () {
                        if (seq !== searchSeq) return;
                        clearResults();
                        setStatus({ key: 'tz.err_search', fallback: 'Could not search. Try again.' });
                    });
            }, 500);
        }

        function applyCity(city) {
            clearTimeout(searchTimeout);
            searchSeq++;
            selectedCity = city;
            clearResults();
            setStatus(null);
            var label = city.name + (city.country ? ', ' + city.country : '');
            if (selectedLabel) {
                selectedLabel.textContent = label;
                selectedLabel.style.display = 'block';
            }
            if (primaryBtn) primaryBtn.disabled = false;

            var region = regionLanguageFor(city.country_code);
            if (region) {
                suggestedCode = region;
                suggestionSource = 'region';
                if (!languageTouched) languageSelect.value = region;
            }
            updateLanguageHint();
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

        function selectedLanguageCode() {
            return languageSelect.value || suggestedCode || currentLangCode;
        }

        function commitCity() {
            if (!selectedCity) return;
            var chosenLanguage = selectedLanguageCode();
            primaryBtn.disabled = true;
            secondaryBtn.disabled = true;
            searchInput.disabled = true;
            languageSelect.disabled = true;
            setStatus({ key: 'common.loading', fallback: 'Loading...' });

            fetch('https://api.open-meteo.com/v1/forecast?latitude=' + selectedCity.latitude +
                '&longitude=' + selectedCity.longitude + '&current_weather=true&timezone=auto')
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    var offsetSeconds = data && data.utc_offset_seconds;
                    if (typeof offsetSeconds !== 'number') throw new Error('missing utc_offset_seconds');
                    var offsetHours = offsetSeconds / 3600;
                    localStorage.setItem('rekindle_timezone_offset', offsetHours);

                    var locData = {
                        name: selectedCity.name || 'Unknown',
                        lat: selectedCity.latitude || 0,
                        lon: selectedCity.longitude || 0,
                        zone: selectedCity.timezone || null,
                        country: selectedCity.country || null,
                        country_code: selectedCity.country_code || null,
                        utc_offset: offsetHours
                    };
                    localStorage.setItem('rekindle_location_manual', JSON.stringify(locData));
                    if (window.rekindleInvalidateTimeCaches) window.rekindleInvalidateTimeCaches();
                    syncTimezoneToProfile(locData, offsetHours);
                    markLanguagePromptSeen();

                    persistLanguageChoice(chosenLanguage, function () {
                        window.location.reload();
                    });
                })
                .catch(function (e) {
                    console.error('Timezone Fetch Error', e);
                    primaryBtn.disabled = false;
                    secondaryBtn.disabled = false;
                    searchInput.disabled = false;
                    languageSelect.disabled = false;
                    setStatus({ key: 'tz.err_fetch', fallback: 'Could not get the timezone. Try again.' });
                });
        }

        function commitLanguage() {
            var chosenLanguage = selectedLanguageCode();
            markLanguagePromptSeen();
            if (chosenLanguage === currentLangCode) {
                dismissTimezonePrompt();
                return;
            }
            primaryBtn.disabled = true;
            secondaryBtn.disabled = true;
            languageSelect.disabled = true;
            setStatus({ key: 'common.loading', fallback: 'Loading...' });
            persistLanguageChoice(chosenLanguage, function () {
                window.location.reload();
            });
        }

        // --- Wiring ------------------------------------------------------
        populateLanguages();

        languageSelect.addEventListener('change', function () {
            languageTouched = true;
            previewLanguage(this.value);
        });

        if (searchInput) {
            searchInput.addEventListener('input', function () {
                handleSearchInput(this.value);
            });
        }

        primaryBtn.addEventListener('click', function () {
            if (isLanguageOnly) commitLanguage();
            else commitCity();
        });

        secondaryBtn.addEventListener('click', function () {
            if (isLanguageOnly) {
                markLanguagePromptSeen();
            } else {
                snoozeTzPrompt();
            }
            dismissTimezonePrompt();
        });

        if (loginBtn) {
            loginBtn.addEventListener('click', function () {
                // Canonical sign-in is the popup on the index page; login.html
                // is a diagnostics page and must not be a login destination.
                window.location.href = 'index?login=true';
            });
        }

        if (guestBtn) {
            guestBtn.addEventListener('click', function () {
                try { sessionStorage.setItem('rekindle_tz_guest', '1'); } catch (e) { }
                showStep('main');
            });
        }

        if (laterSigninBtn) {
            laterSigninBtn.addEventListener('click', function () {
                snoozeTzPrompt();
                dismissTimezonePrompt();
            });
        }

        if (backBtn) {
            backBtn.addEventListener('click', function () {
                showStep('signin');
            });
        }

        var requestBtn = document.getElementById('tz-request-btn');
        if (requestBtn) requestBtn.addEventListener('click', goToLanguageRequest);
        if (requestSigninBtn) requestSigninBtn.addEventListener('click', goToLanguageRequest);

        // If Firebase restores a signed-in session after the sign-in step was
        // shown (e.g. localStorage was cleared), skip straight to setup.
        if (startOnSignIn) {
            try {
                if (typeof firebase !== 'undefined' && firebase.auth) {
                    var authUnsub = firebase.auth().onAuthStateChanged(function (user) {
                        if (!user) return;
                        var backLine = document.getElementById('tz-back-line');
                        if (backLine) backLine.style.display = 'none';
                        if (currentStep === 'signin') showStep('main');
                    });
                    overlay._tzAuthUnsub = authUnsub;
                }
            } catch (e) { }
        }

        // Locale files arrive shortly after the prompt is injected. Re-render
        // the JS-built hint/status strings when that happens, and stop when
        // the prompt is closed.
        function onLocaleReady() {
            if (!document.body.contains(overlay)) {
                document.removeEventListener('rekindle:i18n:ready', onLocaleReady);
                return;
            }
            if (previewDict) {
                // A preview of the page's own language may have run before the
                // locale file arrived; refresh it now.
                if (previewCode === currentLangCode) {
                    previewLanguage(currentLangCode);
                }
                return;
            }
            updateLanguageHint();
            renderStatus();
        }
        overlay._tzLocaleReady = onLocaleReady;
        document.addEventListener('rekindle:i18n:ready', onLocaleReady);
    }

    // --- TIMEZONE PROFILE RESTORE ---
    // After sign-in, pull the account's saved settings/general.manualLocation
    // into localStorage so the timezone prompt does not reappear on the next
    // page. Mirrors login.html's restoreTimezone() — keep the two in sync.
    function dismissTimezonePrompt() {
        var overlay = document.getElementById('tz-warning-overlay');
        if (overlay) {
            if (overlay._tzLocaleReady) {
                document.removeEventListener('rekindle:i18n:ready', overlay._tzLocaleReady);
            }
            if (overlay._tzAuthUnsub) {
                try { overlay._tzAuthUnsub(); } catch (e) { }
            }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
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
