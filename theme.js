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
    window.rekindleApplyTheme = applyTheme;

})();
