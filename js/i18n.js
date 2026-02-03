(function () {
    // 1. Detect Language
    // Check querystring first for testing ?lang=es
    var urlParams = new URLSearchParams(window.location.search);
    var lang = urlParams.get('lang');

    // Then check LocalStorage
    if (!lang) {
        lang = localStorage.getItem('rekindle_language');
    }

    // Then check Browser
    if (!lang) {
        lang = navigator.language.split('-')[0];
    }

    // Default to 'en'
    if (!lang) lang = 'en';

    // 2. Detect Extra Localization File
    var mainScript = document.currentScript || document.querySelector('script[src*="i18n.js"]');
    var extraPrefix = mainScript ? mainScript.getAttribute('data-i18n-file') : null;

    // 3. Expose Globals (Must happen BEFORE early exit)
    window.rekindleTranslations = window.rekindleTranslations || {};
    window.t = function (key, defaultText) {
        if (window.rekindleTranslations && window.rekindleTranslations[key]) {
            return window.rekindleTranslations[key];
        }
        return defaultText || key;
    };

    window.rekindleSetLanguage = function (lang) {
        localStorage.setItem('rekindle_language', lang);
        location.reload();
    };

    window.rekindleApplyTranslations = function (root) {
        if (window.rekindleTranslations) {
            applyTranslations(window.rekindleTranslations, root);
        }
    };

    function notifyReady() {
        window.rekindleI18nReady = true;
        document.dispatchEvent(new CustomEvent('rekindle:i18n:ready', { detail: { lang: lang } }));
    }

    // 4. Lazy Load Translations
    var files = [];
    files.push('locales/' + lang + '.json');
    if (extraPrefix) files.push('locales/' + extraPrefix + '-' + lang + '.json');

    // Optimization: Unblock English users immediately. 
    // They will use in-code defaults until the background fetch completes.
    if (lang === 'en' && !extraPrefix) {
        setTimeout(notifyReady, 0);
    }

    Promise.all(files.map(function (url) {
        return fetch(url).then(function (res) { return res.ok ? res.json() : {}; });
    })).then(function (results) {
        var translations = {};
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            for (var key in r) {
                if (r.hasOwnProperty(key)) translations[key] = r[key];
            }
        }

        // Expose for dynamic use
        window.rekindleTranslations = translations;

        // Apply Translations
        applyTranslations(translations);

        // Start Observer for dynamic content
        initObserver(translations);

        // Set HTML Lang
        document.documentElement.lang = lang;
        document.body.classList.add('lang-' + lang);

        // Save choice
        localStorage.setItem('rekindle_language', lang);

        notifyReady();
    }).catch(function (e) {
        console.error('i18n error:', e);
        notifyReady(); // Continue even on error to unblock app
    });

    function applyTranslations(t, root) {
        root = root || document;

        var translate = function (el) {
            var k1 = el.getAttribute('data-i18n');
            if (k1 && t[k1]) el.innerText = t[k1];
            var k2 = el.getAttribute('data-i18n-placeholder');
            if (k2 && t[k2]) el.placeholder = t[k2];
            var k3 = el.getAttribute('data-i18n-title');
            if (k3 && t[k3]) el.title = t[k3];
            var k4 = el.getAttribute('data-i18n-only');
            if (k4) el.style.display = (k4 === lang) ? '' : 'none';
            var k5 = el.getAttribute('data-i18n-html');
            if (k5 && t[k5]) el.innerHTML = t[k5];
        };

        var selector = '[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-only], [data-i18n-html]';
        var els = root.querySelectorAll ? root.querySelectorAll(selector) : [];
        for (var i = 0; i < els.length; i++) translate(els[i]);
        if (root !== document && root.getAttribute && (
            root.getAttribute('data-i18n') || root.getAttribute('data-i18n-placeholder') ||
            root.getAttribute('data-i18n-title') || root.getAttribute('data-i18n-only') ||
            root.getAttribute('data-i18n-html')
        )) {
            translate(root);
        }
    }


    // 5. Dynamic Content Observer
    function initObserver(translations) {
        if (typeof MutationObserver === 'undefined') return;

        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1) { // 1 = Element
                        applyTranslations(translations, node);
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

})();
