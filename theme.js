(function () {

    // --- PRETTY URLS (Global) ---
    // Automatically strip .html from URL bar
    if (window.location.pathname.endsWith('.html')) {
        var cleanUrl = window.location.pathname.replace('.html', '');
        // Keep the query string: ?lang=de and ?login=true are read later by
        // i18n / index and must survive the pretty-URL rewrite (the local
        // .html test URLs depend on this).
        window.history.replaceState(null, '', cleanUrl + window.location.search);
    }

    // --- CONFIGURATION ---
    var THEME_KEY = 'rekindle_theme_mode'; // 'light', 'dark', 'auto'
    var AUTO_START_HOUR = 18; // 6 PM
    var AUTO_END_HOUR = 6;    // 6 AM
    var ROTATION_KEY = 'rekindle_rotation'; // '0', '90', '180', '270'
    var FONT_KEY = 'rekindle_font_opendyslexic'; // 'true', 'false'

    // Temporarily force light mode while dark mode is disabled.
    var storedMode = localStorage.getItem(THEME_KEY);
    if (storedMode === 'dark' || storedMode === 'auto') {
        localStorage.setItem(THEME_KEY, 'light');
    }

    function applyTheme() {
        // Temporarily force light mode regardless of saved preference.
        var mode = 'light';
        var isDark = false;

        if (mode === 'dark') {
            isDark = true;
        } else if (mode === 'auto') {
            var now = new Date();
            var hour = now.getHours();
            // Check if it's night time (after start hour OR before end hour)
            if (hour >= AUTO_START_HOUR || hour < AUTO_END_HOUR) {
                isDark = true;
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                isDark = true;
            }
        }

        var doc = document.documentElement;
        if (isDark) {
            doc.style.colorScheme = 'dark';
            doc.setAttribute('data-theme', 'dark');
            injectDarkStyles();
        } else {
            doc.style.colorScheme = 'light';
            doc.removeAttribute('data-theme');
            removeDarkStyles();
        }
    }

    function injectDarkStyles() {
        // 1. Try to set CSS variables if they exist (modern apps)
        document.documentElement.style.setProperty('--bg-color', '#000000');
        document.documentElement.style.setProperty('--text-color', '#ffffff');
        document.documentElement.style.setProperty('--border-color', '#ffffff');
        // Invert patterns or set to black

        // 2. Inject global override styles for legacy/non-var apps
        var style = document.getElementById('rekindle-dark-theme');
        if (!style) {
            style = document.createElement('style');
            style.id = 'rekindle-dark-theme';
            style.textContent =
                '/* UNIVERSAL DARK MODE OVERRIDES */\n' +
                ':root[data-theme="dark"] {\n' +
                '    --bg-color: #000000;\n' +
                '    --text-color: #ffffff;\n' +
                '    background-color: #ffffff;\n' +
                '    color: #000000;\n' +
                '    height: 100%;\n' +
                '    filter: invert(1) hue-rotate(180deg);\n' +
                '}\n' +
                ':root[data-theme="dark"] img, \n' +
                ':root[data-theme="dark"] video, \n' +
                ':root[data-theme="dark"] canvas,\n' +
                ':root[data-theme="dark"] .no-invert {\n' +
                '    filter: invert(1) hue-rotate(180deg);\n' +
                '}\n' +
                ':root[data-theme="dark"] img.keep-white {\n' +
                '    filter: none;\n' +
                '}\n';
            document.head.appendChild(style);
        }
    }

    function removeDarkStyles() {
        document.documentElement.style.removeProperty('--bg-color');
        document.documentElement.style.removeProperty('--text-color');
        document.documentElement.style.removeProperty('--border-color');

        var style = document.getElementById('rekindle-dark-theme');
        if (style) style.remove();
    }

    // Export for Settings App to call
    // --- DISPLAY MODE ---
    var DISPLAY_MODE_KEY = 'rekindle_display_mode'; // 'eink' (default), 'led'

    function getDisplayMode() {
        return localStorage.getItem(DISPLAY_MODE_KEY) || 'led';
    }

    // --- SCALING ---
    var SCALE_KEY = 'rekindle_scale'; // '1.0', '0.9', etc.
    var SCALE_AUTO_KEY = 'rekindle_scale_auto'; // 'true', 'false'

    function injectScalingStyle() {
        var style = document.getElementById('rekindle-scaling-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'rekindle-scaling-style';
            document.head.appendChild(style);
        }

        var scale = localStorage.getItem(SCALE_KEY) || '1.0';
        var finalScale = (scale === 'auto') ? '1.0' : scale;

        // Set CSS custom property for apps that want selective scaling
        document.documentElement.style.setProperty('--rekindle-scale', finalScale);

        var scaledMaxHeight = 95 / parseFloat(finalScale);
        var minHeightRule = parseFloat(finalScale) > 1.0 ? 'min-height: 0 !important; ' : '';

        style.textContent =
            '.dashboard, .desktop-wrapper, .sys-menu-bar, .window { ' +
            'zoom: ' + finalScale + '; ' +
            '} ' +
            ':root { ' +
            '--scaled-window-vh: ' + scaledMaxHeight + 'vh; ' +
            '} ' +
            '.window { ' +
            'max-height: ' + scaledMaxHeight + 'vh !important; ' +
            minHeightRule +
            '} ' +
            '.window.fullscreen { ' +
            'max-height: none !important; ' +
            '} ' +
            '.window.scaled-height { ' +
            'height: ' + scaledMaxHeight + 'vh !important; ' +
            '} ' +
            '@supports not (zoom: 1) { ' +
            '.dashboard, .desktop-wrapper, .window { ' +
            'transform: scale(' + finalScale + '); ' +
            'transform-origin: top center; ' +
            '} ' +
            '.sys-menu-bar { ' +
            'transform: scale(' + finalScale + '); ' +
            'transform-origin: top left; ' +
            'width: calc(100% / ' + finalScale + ') !important; ' +
            '} ' +
            '}';
    }

    function applyScale() {
        if (document.documentElement.hasAttribute('data-no-scale')) {
            // Remove the style if it exists
            var style = document.getElementById('rekindle-scaling-style');
            if (style) style.remove();
            return;
        }
        injectScalingStyle();
    }

    // --- ROTATION ---
    function injectRotationStyle() {
        var style = document.getElementById('rekindle-rotation-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'rekindle-rotation-style';
            document.head.appendChild(style);
        }

        var rotation = localStorage.getItem(ROTATION_KEY) || '0';
        var css = '';

        if (rotation === '90') {
            css = 'html { overflow: hidden !important; width: 100vw !important; height: 100vh !important; } ' +
                'body { width: 100vh !important; height: 100vw !important; overflow: hidden !important; position: fixed !important; top: 0; left: 0; padding: 5px !important; box-sizing: border-box !important; ' +
                'transform: rotate(90deg); transform-origin: top left; left: 100vw; } ' +
                '.window, .dashboard, .desktop-wrapper { max-height: calc(100vw - 10px) !important; box-sizing: border-box !important; } ' +
                '.window.fullscreen { width: 100% !important; height: 100% !important; top: 0 !important; left: 0 !important; transform: none !important; }';
        } else if (rotation === '180') {
            css = 'body { transform: rotate(180deg); transform-origin: center center; }';
        } else if (rotation === '270') {
            css = 'html { overflow: hidden !important; width: 100vw !important; height: 100vh !important; } ' +
                'body { width: 100vh !important; height: 100vw !important; overflow: hidden !important; position: fixed !important; top: 0; left: 0; padding: 5px !important; box-sizing: border-box !important; ' +
                'transform: rotate(270deg); transform-origin: top left; top: 100vh; } ' +
                '.window, .dashboard, .desktop-wrapper { max-height: calc(100vw - 10px) !important; box-sizing: border-box !important; } ' +
                '.window.fullscreen { width: 100% !important; height: 100% !important; top: 0 !important; left: 0 !important; transform: none !important; }';
        }

        style.textContent = css;
    }

    function injectEInkStyles() {
        var mode = getDisplayMode();
        // If mode is eink (or not led), disable animations
        if (mode === 'eink') {
            var style = document.getElementById('rekindle-eink-optimizations');
            if (!style) {
                style = document.createElement('style');
                style.id = 'rekindle-eink-optimizations';
                style.textContent =
                    '/* E-INK OPTIMIZATIONS: Disable animations and transitions */\n' +
                    '*, *:before, *:after {\n' +
                    '    transition: none !important;\n' +
                    '    animation: none !important;\n' +
                    '}\n';
                document.head.appendChild(style);
            }
        } else {
            var style = document.getElementById('rekindle-eink-optimizations');
            if (style) style.remove();
        }
    }

    function applyRotation() {
        injectRotationStyle();
    }

    function init() {
        applyTheme();
        applyScale();
        applyRotation();
        applyViewport();
        injectEInkStyles();
        applyFont();
    }

    // Run once, immediately. Every apply* helper lazily creates its own <style>
    // in <head>, which already exists while the page is parsing, so the old
    // "run now AND again on DOMContentLoaded" pair only doubled the work
    // (two stylesheet rewrites + recalcs per page) for no benefit.
    init();

    // --- VIEWPORT ---
    function applyViewport() {
        var viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.appendChild(viewport);
        }
        viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    }
    window.rekindleApplyViewport = applyViewport;

    function autoDetectScale() {
        var autoEnabled = localStorage.getItem(SCALE_AUTO_KEY) !== 'false'; // Default to true

        if (autoEnabled) {
            // Kindle Paperwhite baseline: below 800x906 the UI is scaled down to
            // fit. 732x762 (Kobo Libra Colour) therefore lands on 0.75, which is
            // kept deliberately: at 1.0 the home screen loses its two-column
            // featured grid and pushes "All Applications" below the fold, and the
            // real Kobo layout bugs were the missing scroll (applyOverflowFallback)
            // and the 2009 box model in the old builds, not the zoom itself.
            var targetW = 800;
            var targetH = 906;
            var currentW = window.innerWidth;
            var currentH = window.innerHeight;

            var scale = '1.0';
            if (currentW < targetW || currentH < targetH) {
                var scaleW = currentW / targetW;
                var scaleH = currentH / targetH;
                var autoScale = Math.min(scaleW, scaleH);

                // Find closest from supported options: 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0
                var options = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
                var closest = options[0];
                var minDiff = Math.abs(autoScale - closest);

                for (var i = 1; i < options.length; i++) {
                    var diff = Math.abs(autoScale - options[i]);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = options[i];
                    }
                }
                scale = closest.toString();
            }

            localStorage.setItem(SCALE_KEY, scale);
            applyScale();
        }
    }

    // --- OVERFLOW FALLBACK ---
    // Pages size their window in vh and set body { overflow: hidden }. When the
    // content is taller than the viewport (Settings, Chess, KindleChat on a
    // short screen) the bottom is clipped with no scrollbar and no way to reach
    // it. After paint, if the document really is taller than the viewport,
    // switch the page to a normal scrolling document.
    //
    // The class goes on <html>, never on <body>: post-load <body> class changes
    // drop elements on the Kobo/QtWebKit repaint path (see legacy-build.md).
    var OVERFLOW_CLASS = 'rekindle-page-scroll';

    function injectOverflowStyle() {
        if (document.getElementById('rekindle-overflow-style')) return;
        var style = document.createElement('style');
        style.id = 'rekindle-overflow-style';
        style.textContent =
            'html.' + OVERFLOW_CLASS + ' { height: auto !important; overflow-x: hidden !important; overflow-y: auto !important; } ' +
            'html.' + OVERFLOW_CLASS + ' body { height: auto !important; min-height: 100vh !important; overflow-x: hidden !important; overflow-y: auto !important; } ' +
            // The window must be allowed to grow past the 95vh budget, otherwise
            // the page scrolls around a window that still clips its own content.
            'html.' + OVERFLOW_CLASS + ' .window { max-height: none !important; margin-top: 10px !important; margin-bottom: 10px !important; }';
        document.head.appendChild(style);
    }

    function applyOverflowFallback() {
        if (!document.body) return;
        var root = document.documentElement;
        if ((' ' + root.className + ' ').indexOf(' ' + OVERFLOW_CLASS + ' ') !== -1) return;
        // Stay off pages that intentionally lock the viewport (position: fixed
        // bodies) and pages where the content already fits.
        if (root.scrollHeight <= window.innerHeight + 2) return;
        injectOverflowStyle();
        root.className += ' ' + OVERFLOW_CLASS;
    }
    window.rekindleApplyOverflowFallback = applyOverflowFallback;

    function scheduleOverflowFallback() {
        if (document.readyState === 'complete') applyOverflowFallback();
        else window.addEventListener('load', applyOverflowFallback);
        // Late content (Firebase lists, i18n re-flow, images) changes the height
        // after load, so re-check once the quiet period has passed.
        setTimeout(applyOverflowFallback, 1200);
        setTimeout(applyOverflowFallback, 3000);
        window.addEventListener('resize', applyOverflowFallback);
        window.addEventListener('orientationchange', applyOverflowFallback);
    }
    scheduleOverflowFallback();

    // --- UNIT SYSTEM ---
    var UNIT_KEY = 'rekindle_unit_system'; // 'metric', 'imperial', 'auto'
    var IMPERIAL_COUNTRIES = ['US', 'LR', 'MM'];

    function getUnitSystem() {
        var pref = localStorage.getItem(UNIT_KEY) || 'auto';
        if (pref !== 'auto') return pref;

        // Auto Logic
        // 1. Check Manual Location
        try {
            var manualLoc = JSON.parse(localStorage.getItem('rekindle_location_manual'));
            if (manualLoc && manualLoc.name) {
                // We stored country code in weather.html setLocation but not explicitly here in theme.js context usually.
                // However, let's try to infer or fallback.
                // Actually, weather.html saves it as {name, lat, lon, zone, country_code (maybe?)}.
                // Let's check what weather.html actually saves. It saves {name, lat, lon, zone}. 
                // It does NOT save country code in 'rekindle_location_manual'. 
                // Wait, in my analysis of weather.html lines 1194: 
                // const locData = { name: city.name, lat: city.latitude, lon: city.longitude, zone: city.timezone };
                // It does not save country code. I should probably update weather.html to save country code too if I want to be precise,
                // OR just rely on timezone? Timezone 'America/New_York' -> US.
                // Simpler: Allow 'rekindle_weather_settings' to guide us? That has 'autoUnit'.

                // Let's look at available data. 
                // Option A: Use 'rekindle_weather_settings' which stores 'autoUnit' ('celsius'/'fahrenheit') calculated from country code.
                // We can proxy that: Celsius -> Metric, Fahrenheit -> Imperial.
                var weatherSettings = JSON.parse(localStorage.getItem('rekindle_weather_settings'));
                if (weatherSettings && weatherSettings.locations && weatherSettings.locations.length > 0) {
                    // Get the current location's autoUnit (not the top-level one which is never updated)
                    var currentIdx = weatherSettings.currentIndex || 0;
                    var currentLoc = weatherSettings.locations[currentIdx] || weatherSettings.locations[0];
                    if (currentLoc && currentLoc.autoUnit) {
                        return currentLoc.autoUnit === 'fahrenheit' ? 'imperial' : 'metric';
                    }
                }
            }
        } catch (e) { }

        // 2. Default if no location data found: Metric (Standard World)
        return 'metric';
    }

    function convertDistance(meters) {
        var system = getUnitSystem();
        if (system === 'imperial') {
            var miles = meters * 0.000621371;
            if (miles < 0.1) {
                return Math.round(meters * 3.28084) + ' ft';
            }
            return miles.toFixed(1) + ' mi';
        } else {
            if (meters < 1000) return Math.round(meters) + ' m';
            return (meters / 1000).toFixed(1) + ' km';
        }
    }

    function convertTemperatureContext(text) {
        if (!text) return text;
        var system = getUnitSystem();

        // Regex to find temps like 180C, 180°C, 350F, 350° deg, etc.
        // We assume input text might vary. 
        // Simple case: Look for C and F explicitly.

        return text.replace(/(\d+)(?:\s?°?\s?)(C|F)\b/gi, function (match, val, unit) {
            var num = parseInt(val);
            var u = unit.toUpperCase();

            if (system === 'metric') {
                if (u === 'F') {
                    // F -> C
                    var c = Math.round((num - 32) * (5 / 9));
                    return c + '°C';
                }
                return num + '°C'; // Standardize
            } else {
                if (u === 'C') {
                    // C -> F
                    var f = Math.round((num * 9 / 5) + 32);
                    return f + '°F';
                }
                return num + '°F'; // Standardize
            }
        });
    }




    // --- FONT LOGIC ---
    function applyFont() {
        var enabled = localStorage.getItem(FONT_KEY) === 'true';
        var doc = document.documentElement;

        if (enabled) {
            doc.setAttribute('data-font', 'opendyslexic');
            injectFontStyle();
        } else {
            doc.removeAttribute('data-font');
            removeFontStyle();
        }
    }

    function injectFontStyle() {
        var style = document.getElementById('rekindle-font-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'rekindle-font-style';
            style.textContent =
                '@font-face {\n' +
                '    font-family: "OpenDyslexic";\n' +
                '    src: url("/fonts/OpenDyslexic-Regular.woff2") format("woff2");\n' +
                '    font-weight: normal;\n' +
                '    font-style: normal;\n' +
                '    size-adjust: 90%;\n' +
                '}\n' +
                '@font-face {\n' +
                '    font-family: "OpenDyslexic";\n' +
                '    src: url("/fonts/OpenDyslexic-Bold.woff2") format("woff2");\n' +
                '    font-weight: bold;\n' +
                '    font-style: normal;\n' +
                '    size-adjust: 90%;\n' +
                '}\n' +
                ':root[data-font="opendyslexic"] body,\n' +
                ':root[data-font="opendyslexic"] button,\n' +
                ':root[data-font="opendyslexic"] input,\n' +
                ':root[data-font="opendyslexic"] textarea,\n' +
                ':root[data-font="opendyslexic"] select,\n' +
                ':root[data-font="opendyslexic"] .nav-item,\n' +
                ':root[data-font="opendyslexic"] .window,\n' +
                ':root[data-font="opendyslexic"] .title-text,\n' +
                ':root[data-font="opendyslexic"] .dashboard,\n' +
                ':root[data-font="opendyslexic"] .sidebar,\n' +
                ':root[data-font="opendyslexic"] .system-header,\n' +
                ':root[data-font="opendyslexic"] .app-icon,\n' +
                ':root[data-font="opendyslexic"] .app-label,\n' +
                ':root[data-font="opendyslexic"] h1,\n' +
                ':root[data-font="opendyslexic"] h2,\n' +
                ':root[data-font="opendyslexic"] h3,\n' +
                ':root[data-font="opendyslexic"] p,\n' +
                ':root[data-font="opendyslexic"] span,\n' +
                ':root[data-font="opendyslexic"] div,\n' +
                ':root[data-font="opendyslexic"] a,\n' +
                ':root[data-font="opendyslexic"] * {\n' +
                '    font-family: "OpenDyslexic", sans-serif !important;\n' +
                '}\n';
            document.head.appendChild(style);
        }
    }

    function removeFontStyle() {
        var style = document.getElementById('rekindle-font-style');
        if (style) style.remove();
    }

    function applyFontHelper() {
        applyFont();
    }
    window.rekindleApplyFont = applyFont;

    // Export for Apps to call
    window.rekindleApplyTheme = applyTheme;
    window.rekindleGetDisplayMode = getDisplayMode;
    window.rekindleApplyScale = applyScale;
    window.rekindleAutoDetectScale = autoDetectScale;
    window.rekindleGetUnitSystem = getUnitSystem;
    window.rekindleConvertDistance = convertDistance;
    window.rekindleConvertTemperatureContext = convertTemperatureContext;
    window.rekindleApplyRotation = applyRotation;
    window.rekindleInjectEInkStyles = injectEInkStyles;
    window.rekindleApplyFont = applyFont;

    // --- WALLPAPER LOGIC ---
    function applyWallpaper() {
        try {
            var wallpaperImg = localStorage.getItem('rekindle_bg_image');
            var wallpaperSize = localStorage.getItem('rekindle_bg_size');
            var wallpaperId = localStorage.getItem('rekindle_wallpaper_id');
            var hasPixelData = localStorage.getItem('rekindle_pixel_data');

            // MIGRATION LOGIC (From index.html):
            // 1. If no image exists (New User)
            // 2. If no pixel data exists (Old User)
            // 3. If ID is not 'custom' (Old User using legacy preset)
            if (!wallpaperImg || !hasPixelData || (wallpaperId && wallpaperId !== 'custom')) {
                // Only run migration if we are in a context that can generate it (requires Canvas)
                // We'll trust the browser can handle basic canvas here.
                console.log("Migrating wallpaper to Classic Dither...");

                var canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                var ctx = canvas.getContext('2d');

                // Fill Background White
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 32, 32);

                // Draw Black Pixels (Classic Dither Pattern)
                ctx.fillStyle = '#000000';
                var ditherPattern = [
                    1, 0, 1, 0, 1, 0, 1, 0,
                    0, 1, 0, 1, 0, 1, 0, 1,
                    1, 0, 1, 0, 1, 0, 1, 0,
                    0, 1, 0, 1, 0, 1, 0, 1,
                    1, 0, 1, 0, 1, 0, 1, 0,
                    0, 1, 0, 1, 0, 1, 0, 1,
                    1, 0, 1, 0, 1, 0, 1, 0,
                    0, 1, 0, 1, 0, 1, 0, 1
                ];

                for (var i = 0; i < 64; i++) {
                    if (ditherPattern[i] === 1) {
                        var col = i % 8;
                        var row = Math.floor(i / 8);
                        ctx.fillRect(col * 4, row * 4, 4, 4);
                    }
                }

                wallpaperImg = 'url(' + canvas.toDataURL('image/png') + ')';
                wallpaperSize = '16px 16px';

                localStorage.setItem('rekindle_bg_image', wallpaperImg);
                localStorage.setItem('rekindle_bg_size', wallpaperSize);
                localStorage.setItem('rekindle_wallpaper_id', 'custom');
                localStorage.setItem('rekindle_pixel_data', JSON.stringify(ditherPattern));
            }

            // SANITIZATION (From reader.html fix)
            function sanitize(imageString) {
                if (!imageString) return '';
                // Allow data URIs (quoted or unquoted)
                if (imageString.startsWith('url(data:image/png;base64,') ||
                    imageString.startsWith('url("data:image/png;base64,') ||
                    imageString.startsWith("url('data:image/png;base64,")) {
                    return imageString;
                }
                // Extract URL wrappers
                var url = '';
                if (imageString.startsWith('url("') && imageString.endsWith('")')) {
                    url = imageString.substring(5, imageString.length - 2);
                } else if (imageString.startsWith("url('") && imageString.endsWith("')")) {
                    url = imageString.substring(5, imageString.length - 2);
                } else if (imageString.startsWith('url(') && imageString.endsWith(')')) {
                    url = imageString.substring(4, imageString.length - 1);
                }
                if (url) {
                    if (url.includes('javascript:') || url.includes('data:')) return '';
                    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
                        return imageString;
                    }
                }
                return '';
            }

            if (wallpaperImg) {
                var safeImg = sanitize(wallpaperImg);
                if (safeImg) {
                    document.body.style.backgroundImage = safeImg;
                }
            }

            // SCALING LOGIC (From reader.html fix)
            if (wallpaperSize) {
                var scaleStr = localStorage.getItem('rekindle_scale') || '1.0';
                var scale = parseFloat(scaleStr);

                if (scale !== 1.0 && wallpaperSize.indexOf('px') !== -1) {
                    wallpaperSize = wallpaperSize.replace(/(\d+(\.\d+)?)px/g, function (match, initialNum) {
                        var val = parseFloat(initialNum);
                        var scaledVal = val * scale;
                        return scaledVal + 'px';
                    });
                }
                document.body.style.backgroundSize = wallpaperSize;
            }

        } catch (e) {
            console.error("Wallpaper apply failed:", e);
        }
    }
    window.rekindleApplyWallpaper = applyWallpaper;

    // --- DEFAULT FULLSCREEN ---
    function applyDefaultFullscreen() {
        if (localStorage.getItem('rekindle_default_fullscreen') === 'true') {
            var win = document.querySelector('.window');
            if (win && !win.classList.contains('fullscreen')) {
                win.classList.add('fullscreen');
            }
        }
    }
    window.rekindleApplyDefaultFullscreen = applyDefaultFullscreen;

    // --- GLOBAL PRESENCE TRACKING ---
    // Writes presence/{uid} = true while connected so live game listings can verify the host is online.
    // The expensive full-node count listener is intentionally omitted.
    window.rekindleInitGlobalPresence = function (db, uid) {
        if (!db || !uid) return;
        var presenceRef = db.ref('presence/' + uid);
        window._rekindlePresenceRef = presenceRef;

        var connectedRef = db.ref('.info/connected');

        if (window._rekindlePresenceListener) {
            connectedRef.off('value', window._rekindlePresenceListener);
        }

        window._rekindlePresenceListener = connectedRef.on('value', function (snap) {
            if (snap.val() === true) {
                presenceRef.onDisconnect().remove().then(function () {
                    presenceRef.set(true);
                }).catch(function () { });
            }
        });
    };

    function autoInitPresence() {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            try {
                var auth = firebase.auth();
                var db = firebase.database();
                if (auth && db) {
                    if (window._rekindlePresenceInited) return true;
                    window._rekindlePresenceInited = true;

                    auth.onAuthStateChanged(function (user) {
                        if (user && window.rekindleInitGlobalPresence) {
                            window.rekindleInitGlobalPresence(db, user.uid);
                        } else if (!user && window._rekindlePresenceRef) {
                            window._rekindlePresenceRef.remove();
                            window._rekindlePresenceRef.onDisconnect().cancel();
                            window._rekindlePresenceRef = null;
                        }
                    });
                    return true;
                }
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    // Try once immediately (the Firebase SDK is usually already parsed), then
    // poll for at most 10s instead of the old 1s x 30 (30s) wakeup tail.
    var presenceAttempts = 0;
    var presenceTimer = null;

    function tryAutoInitPresence() {
        if (autoInitPresence()) {
            if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
            return true;
        }
        return false;
    }

    if (!tryAutoInitPresence()) {
        presenceTimer = setInterval(function () {
            presenceAttempts++;
            if (tryAutoInitPresence() || presenceAttempts >= 20) {
                clearInterval(presenceTimer);
                presenceTimer = null;
            }
        }, 500);
        window.addEventListener('load', tryAutoInitPresence);
    }

    // --- CACHE MANAGEMENT ---
    function clearServiceWorkerCache() {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            console.log('Sending CLEAR_CACHE message to Service Worker...');
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
        }
    }
    window.clearServiceWorkerCache = clearServiceWorkerCache;

    // --- SERVICE WORKER REGISTRATION & AUTO-RELOAD ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('./sw.js')
                .then(function (registration) {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                })
                .catch(function (err) {
                    console.log('ServiceWorker registration failed: ', err);
                });
        });

        // Forced Update Logic: Reload when a new service worker takes control
        var refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (refreshing) return;
            refreshing = true;
            console.log('Service Worker: Controller changed. Reloading page...');
            window.location.reload();
        });
    }

    // --- VIEWPORT LOCKDOWN (Kindle/E-ink) ---
    // Prevent pinch-zoom and double-tap zoom specifically for E-ink browsers that ignore meta tags
    document.addEventListener('touchstart', function (event) {
        if (event.touches.length > 1) {
            event.preventDefault();
        }
    }, { passive: false });

    var lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) {
        var now = (new Date()).getTime();
        // Allow double-tap on editable elements or inputs
        var target = event.target;
        var isEditable = target.isContentEditable ||
            (['input', 'textarea', 'select'].includes(target.tagName.toLowerCase()));

        if (now - lastTouchEnd <= 300 && !isEditable) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, false);

    // --- USER CARD CACHING HELPER ---
    // Two-tier cache: localStorage ("rekindle_ucard_" + uid, { ts, card }, 1 hour TTL)
    // backed by an in-memory map ({ card, ts }, 15 minute TTL). Checking localStorage
    // first means a fresh page load costs zero RTDB reads for cards fetched < 1h ago.
    window.rekindleCardCache = {};
    var _pendingCardFetches = {};
    var _CARD_TTL = 900000;
    var _CARD_LS_TTL = 3600000;
    var _CARD_LS_PREFIX = 'rekindle_ucard_';
    var _CARD_CACHE_MAX = 500;

    function _readStoredCard(uid) {
        try {
            var raw = localStorage.getItem(_CARD_LS_PREFIX + uid);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.ts !== 'number') return null;
            if ((Date.now() - parsed.ts) >= _CARD_LS_TTL) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function _writeStoredCard(uid, card) {
        try {
            localStorage.setItem(_CARD_LS_PREFIX + uid, JSON.stringify({ ts: Date.now(), card: card }));
        } catch (e) { }
    }

    // Cheap guard against unbounded memory growth: drop the single oldest entry.
    function _capCardCache() {
        var keys = Object.keys(window.rekindleCardCache);
        if (keys.length <= _CARD_CACHE_MAX) return;
        var oldestKey = null;
        var oldestTs = Infinity;
        for (var i = 0; i < keys.length; i++) {
            var entry = window.rekindleCardCache[keys[i]];
            var ts = entry && typeof entry.ts === 'number' ? entry.ts : 0;
            if (ts < oldestTs) { oldestTs = ts; oldestKey = keys[i]; }
        }
        if (oldestKey) delete window.rekindleCardCache[oldestKey];
    }

    window.rekindleFetchUserCard = function (db, uid, callback) {
        if (!uid || !db) { callback(null); return; }
        var stored = _readStoredCard(uid);
        if (stored) {
            window.rekindleCardCache[uid] = { card: stored.card, ts: Date.now() };
            _capCardCache();
            callback(stored.card);
            return;
        }
        var cached = window.rekindleCardCache[uid];
        if (cached && (Date.now() - cached.ts) < _CARD_TTL) {
            callback(cached.card);
            return;
        }
        if (_pendingCardFetches[uid]) {
            _pendingCardFetches[uid].push(callback);
            return;
        }
        _pendingCardFetches[uid] = [callback];
        db.ref('user_cards/' + uid).once('value').then(function (snap) {
            var card = snap.exists() ? snap.val() : null;
            window.rekindleCardCache[uid] = { card: card, ts: Date.now() };
            _capCardCache();
            _writeStoredCard(uid, card);
            var cbs = _pendingCardFetches[uid];
            delete _pendingCardFetches[uid];
            cbs.forEach(function (cb) { cb(card); });
        }).catch(function () {
            var cbs = _pendingCardFetches[uid];
            delete _pendingCardFetches[uid];
            cbs.forEach(function (cb) { cb(null); });
        });
    };
    window.rekindleInvalidateUserCard = function (uid) {
        if (!uid) return;
        delete window.rekindleCardCache[uid];
        try { localStorage.removeItem(_CARD_LS_PREFIX + uid); } catch (e) { }
    };

    // --- AVATAR CACHING HELPER ---
    // Delegates to rekindleFetchUserCard so avatar and card lookups share a single
    // cache/read path (previously this read the same user_cards node through its
    // own cache, doubling RTDB reads for one uid).
    window.rekindleFetchAvatarSeed = function (db, uid, callback) {
        if (!uid) { callback('default'); return; }
        if (!db) { callback(uid); return; }
        window.rekindleFetchUserCard(db, uid, function (card) {
            var seed = (card && (card.customAvatar || card.avatarSeed)) || uid;
            callback(seed);
        });
    };

})();
