(function () {
    // --- CONFIGURATION ---
    const THEME_KEY = 'rekindle_theme_mode'; // 'light', 'dark', 'auto'
    const AUTO_START_HOUR = 18; // 6 PM
    const AUTO_END_HOUR = 6;    // 6 AM

    function applyTheme() {
        const mode = localStorage.getItem(THEME_KEY) || 'light';
        let isDark = false;

        if (mode === 'dark') {
            isDark = true;
        } else if (mode === 'auto') {
            const now = new Date();
            const hour = now.getHours();
            // Check if it's night time (after start hour OR before end hour)
            if (hour >= AUTO_START_HOUR || hour < AUTO_END_HOUR) {
                isDark = true;
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                // Also respect system preference if supported and not explicitly "day" time? 
                // Actually user said "night time", implying time-based, but auto often implies system.
                // Let's do: Time OR System.
                isDark = true;
            }
        }

        const doc = document.documentElement;
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
        let style = document.getElementById('rekindle-dark-theme');
        if (!style) {
            style = document.createElement('style');
            style.id = 'rekindle-dark-theme';
            style.textContent = `
                /* UNIVERSAL DARK MODE OVERRIDES */
                :root[data-theme="dark"] {
                    --bg-color: #000000;
                    --text-color: #ffffff;
                    background-color: #ffffff;
                    height: 100%;
                    filter: invert(1) hue-rotate(180deg);
                }
                
                /* Invert back images/likely-images to look normal-ish */
                :root[data-theme="dark"] img, 
                :root[data-theme="dark"] video, 
                :root[data-theme="dark"] canvas,
                :root[data-theme="dark"] .no-invert {
                    filter: invert(1) hue-rotate(180deg);
                }
                
                :root[data-theme="dark"] img.keep-white {
                    filter: none;
                }

                /* Special handling for "window" UI to keep borders visible but inverted content */
                /* Actually, a full page filter invert is often the most robust way to handle 'legacy' white-bg apps 
                   without rewriting every CSS file. ReKindle apps are 1-bit aesthetics mostly.
                   Let's try the CSS filter approach first as it handles the "System 7" look well (Black on White -> White on Black).
                */
            `;
            document.head.appendChild(style);
        }
    }

    function removeDarkStyles() {
        document.documentElement.style.removeProperty('--bg-color');
        document.documentElement.style.removeProperty('--text-color');
        document.documentElement.style.removeProperty('--border-color');

        const style = document.getElementById('rekindle-dark-theme');
        if (style) style.remove();
    }

    // Run immediately
    applyTheme();

    // Export for Settings App to call
    // --- DISPLAY MODE ---
    const DISPLAY_MODE_KEY = 'rekindle_display_mode'; // 'eink' (default), 'led'

    function getDisplayMode() {
        return localStorage.getItem(DISPLAY_MODE_KEY) || 'eink';
    }

    // --- SCALING ---
    const SCALE_KEY = 'rekindle_scale'; // '1.0', '0.9', etc.
    const SCALE_AUTO_KEY = 'rekindle_scale_auto'; // 'true', 'false'

    function injectScalingStyle() {
        let style = document.getElementById('rekindle-scaling-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'rekindle-scaling-style';
            document.head.appendChild(style);
        }

        var scale = localStorage.getItem(SCALE_KEY) || '1.0';
        var finalScale = (scale === 'auto') ? '1.0' : scale;

        // Set CSS custom property for apps that want selective scaling
        document.documentElement.style.setProperty('--rekindle-scale', finalScale);

        style.textContent = `
            .dashboard, .window { 
                zoom: ${finalScale}; 
            }
            @supports not (zoom: 1) {
                .dashboard, .window {
                    transform: scale(${finalScale});
                    transform-origin: top center;
                }
            }
        `;
    }

    function applyScale() {
        injectScalingStyle();
    }

    function init() {
        applyTheme();
        applyScale();
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

    // Export for Apps to call
    window.rekindleApplyTheme = applyTheme;
    window.rekindleGetDisplayMode = getDisplayMode;
    window.rekindleApplyScale = applyScale;
    window.rekindleAutoDetectScale = autoDetectScale;

})();
