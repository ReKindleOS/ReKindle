(function () {

    // --- PRETTY URLS (Global) ---
    // Automatically strip .html from URL bar
    if (window.location.pathname.endsWith('.html')) {
        var cleanUrl = window.location.pathname.replace('.html', '');
        window.history.replaceState(null, '', cleanUrl);
    }

    // --- CONFIGURATION ---
    var THEME_KEY = 'rekindle_theme_mode'; // 'light', 'dark', 'auto'
    var AUTO_START_HOUR = 18; // 6 PM
    var AUTO_END_HOUR = 6;    // 6 AM
    var ROTATION_KEY = 'rekindle_rotation'; // '0', '90', '180', '270'

    function applyTheme() {
        var mode = localStorage.getItem(THEME_KEY) || 'light';
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
            doc.setAttribute('data-theme', 'dark');
            injectDarkStyles();
        } else {
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

    // Run immediately
    applyTheme();

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

        style.textContent =
            '.dashboard, .window { ' +
            'zoom: ' + finalScale + '; ' +
            '} ' +
            '@supports not (zoom: 1) { ' +
            '.dashboard, .window { ' +
            'transform: scale(' + finalScale + '); ' +
            'transform-origin: top center; ' +
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
                'body { width: 100vh !important; height: 100vw !important; overflow: hidden !important; position: fixed !important; top: 0; left: 0; ' +
                'transform: rotate(90deg); transform-origin: top left; left: 100vw; }';
        } else if (rotation === '180') {
            css = 'body { transform: rotate(180deg); transform-origin: center center; }';
        } else if (rotation === '270') {
            css = 'html { overflow: hidden !important; width: 100vw !important; height: 100vh !important; } ' +
                'body { width: 100vh !important; height: 100vw !important; overflow: hidden !important; position: fixed !important; top: 0; left: 0; ' +
                'transform: rotate(270deg); transform-origin: top left; top: 100vh; }';
        }

        style.textContent = css;
    }

    function applyRotation() {
        injectRotationStyle();
    }

    function init() {
        applyTheme();
        applyScale();
        applyRotation();
        applyViewport();
    }

    // Run as soon as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Still run theme/scale immediately in case it's in the head (prevents flash)
    applyTheme();
    applyScale();
    applyRotation();
    applyViewport();

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
                if (weatherSettings && weatherSettings.autoUnit) {
                    return weatherSettings.autoUnit === 'fahrenheit' ? 'imperial' : 'metric';
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




    // Export for Apps to call
    window.rekindleApplyTheme = applyTheme;
    window.rekindleGetDisplayMode = getDisplayMode;
    window.rekindleApplyScale = applyScale;
    window.rekindleAutoDetectScale = autoDetectScale;
    window.rekindleGetUnitSystem = getUnitSystem;
    window.rekindleConvertDistance = convertDistance;
    window.rekindleConvertTemperatureContext = convertTemperatureContext;
    window.rekindleApplyRotation = applyRotation;

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

    // Timezone Exports REMOVED (Moved to time.js)


})();
