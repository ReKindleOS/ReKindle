(function () {
    'use strict';

    /* ------------------------------------------------------------------
     * LANGUAGE REGISTRY - the single source of truth for UI languages.
     *
     * Add a language here (and to SHIPPED once its locale files exist); every
     * page then gets it automatically: js/i18n.js resolves the language,
     * settings.html builds its dropdown from shippedLanguages(), and the social
     * pages use current()/resolveAuto() instead of their old private maps.
     *
     * `countries` is deliberately not stored per language: a country can have
     * several official languages (BE, CA, CH, IN...), so COUNTRY_LANGUAGE is a
     * flat table and the first shipped match wins. Kindles can report
     * navigator.language as en-US regardless of the account's language, which
     * is why the country table matters for "Auto (Location)".
     *
     * Test guard: node scripts/test-locales.js checks every SHIPPED code has
     * locales/<code>.json + locales/privacy-<code>.json, that no orphan locale
     * file exists, and that ${placeholders} match en.json.
     * ---------------------------------------------------------------- */
    var LANGUAGES = [
        { code: 'en', name: 'English', native: 'English', dir: 'ltr' },
        { code: 'de', name: 'German', native: 'Deutsch', dir: 'ltr' },
        { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr' },
        { code: 'fr', name: 'French', native: 'Français', dir: 'ltr' },
        { code: 'it', name: 'Italian', native: 'Italiano', dir: 'ltr' },
        { code: 'pl', name: 'Polish', native: 'Polski', dir: 'ltr' },
        { code: 'pt', name: 'Portuguese', native: 'Português', dir: 'ltr' },
        { code: 'ru', name: 'Russian', native: 'Русский', dir: 'ltr' },
        { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', dir: 'ltr' },
        { code: 'zh', name: 'Chinese', native: '中文', dir: 'ltr' },
        { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', dir: 'ltr' },
        { code: 'nl', name: 'Dutch', native: 'Nederlands', dir: 'ltr' },
        { code: 'sv', name: 'Swedish', native: 'Svenska', dir: 'ltr' },
        { code: 'da', name: 'Danish', native: 'Dansk', dir: 'ltr' },
        { code: 'no', name: 'Norwegian', native: 'Norsk', dir: 'ltr' },
        { code: 'fi', name: 'Finnish', native: 'Suomi', dir: 'ltr' },
        { code: 'is', name: 'Icelandic', native: 'Íslenska', dir: 'ltr' },
        { code: 'tr', name: 'Turkish', native: 'Türkçe', dir: 'ltr' },
        { code: 'cs', name: 'Czech', native: 'Čeština', dir: 'ltr' },
        { code: 'sk', name: 'Slovak', native: 'Slovenčina', dir: 'ltr' },
        { code: 'hu', name: 'Hungarian', native: 'Magyar', dir: 'ltr' },
        { code: 'ro', name: 'Romanian', native: 'Română', dir: 'ltr' },
        { code: 'bg', name: 'Bulgarian', native: 'Български', dir: 'ltr' },
        { code: 'uk', name: 'Ukrainian', native: 'Українська', dir: 'ltr' },
        { code: 'sr', name: 'Serbian', native: 'Српски', dir: 'ltr' },
        { code: 'hr', name: 'Croatian', native: 'Hrvatski', dir: 'ltr' },
        { code: 'sl', name: 'Slovenian', native: 'Slovenščina', dir: 'ltr' },
        { code: 'bs', name: 'Bosnian', native: 'Bosanski', dir: 'ltr' },
        { code: 'mk', name: 'Macedonian', native: 'Македонски', dir: 'ltr' },
        { code: 'sq', name: 'Albanian', native: 'Shqip', dir: 'ltr' },
        { code: 'el', name: 'Greek', native: 'Ελληνικά', dir: 'ltr' },
        { code: 'he', name: 'Hebrew', native: 'עברית', dir: 'rtl' },
        { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl' },
        { code: 'fa', name: 'Persian', native: 'فارسی', dir: 'rtl' },
        { code: 'ur', name: 'Urdu', native: 'اردو', dir: 'rtl' },
        { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
        { code: 'bn', name: 'Bengali', native: 'বাংলা', dir: 'ltr' },
        { code: 'ta', name: 'Tamil', native: 'தமிழ்', dir: 'ltr' },
        { code: 'te', name: 'Telugu', native: 'తెలుగు', dir: 'ltr' },
        { code: 'th', name: 'Thai', native: 'ไทย', dir: 'ltr' },
        { code: 'ja', name: 'Japanese', native: '日本語', dir: 'ltr' },
        { code: 'ko', name: 'Korean', native: '한국어', dir: 'ltr' },
        { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', dir: 'ltr' },
        { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', dir: 'ltr' },
        { code: 'tl', name: 'Filipino', native: 'Filipino', dir: 'ltr' },
        { code: 'sw', name: 'Swahili', native: 'Kiswahili', dir: 'ltr' },
        { code: 'af', name: 'Afrikaans', native: 'Afrikaans', dir: 'ltr' },
        { code: 'ca', name: 'Catalan', native: 'Català', dir: 'ltr' },
        { code: 'gl', name: 'Galician', native: 'Galego', dir: 'ltr' },
        { code: 'eu', name: 'Basque', native: 'Euskara', dir: 'ltr' },
        { code: 'lt', name: 'Lithuanian', native: 'Lietuvių', dir: 'ltr' },
        { code: 'lv', name: 'Latvian', native: 'Latviešu', dir: 'ltr' },
        { code: 'et', name: 'Estonian', native: 'Eesti', dir: 'ltr' },
        { code: 'ga', name: 'Irish', native: 'Gaeilge', dir: 'ltr' },
        { code: 'cy', name: 'Welsh', native: 'Cymraeg', dir: 'ltr' },
        { code: 'lb', name: 'Luxembourgish', native: 'Lëtzebuergesch', dir: 'ltr' },
        { code: 'km', name: 'Khmer', native: 'ខ្មែរ', dir: 'ltr' },
        { code: 'my', name: 'Burmese', native: 'မြန်မာ', dir: 'ltr' },
        { code: 'si', name: 'Sinhala', native: 'සිංහල', dir: 'ltr' },
        { code: 'ne', name: 'Nepali', native: 'नेपाली', dir: 'ltr' },
        { code: 'uz', name: 'Uzbek', native: 'Oʻzbekcha', dir: 'ltr' },
        { code: 'kk', name: 'Kazakh', native: 'Қазақша', dir: 'ltr' },
        { code: 'mn', name: 'Mongolian', native: 'Монгол', dir: 'ltr' },
        { code: 'ka', name: 'Georgian', native: 'ქართული', dir: 'ltr' },
        { code: 'hy', name: 'Armenian', native: 'Հայերեն', dir: 'ltr' },
        { code: 'az', name: 'Azerbaijani', native: 'Azərbaycanca', dir: 'ltr' },
        { code: 'am', name: 'Amharic', native: 'አማርኛ', dir: 'ltr' },
        { code: 'yo', name: 'Yoruba', native: 'Yorùbá', dir: 'ltr' },
        { code: 'ku', name: 'Kurdish', native: 'Kurdî', dir: 'ltr' },
        { code: 'lo', name: 'Lao', native: 'ລາວ', dir: 'ltr' },
        { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', dir: 'ltr' },
        { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', dir: 'ltr' },
        { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', dir: 'ltr' },
        { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', dir: 'ltr' },
        { code: 'ml', name: 'Malayalam', native: 'മലയാളം', dir: 'ltr' },
        { code: 'mr', name: 'Marathi', native: 'मराठी', dir: 'ltr' },
        { code: 'be', name: 'Belarusian', native: 'Беларуская', dir: 'ltr' }
    ];

    var LANGUAGE_BY_CODE = {};
    for (var li = 0; li < LANGUAGES.length; li++) {
        LANGUAGE_BY_CODE[LANGUAGES[li].code] = LANGUAGES[li];
    }

    // Country -> language. Keep CH=de, CA=fr and SG=zh: those are the existing
    // choices, and changing them would silently move users to another language.
    // Ambiguous countries (IN, PK, PH, MY, KE, TZ, ZA) are deliberately absent,
    // as are English-majority countries: the en fallback already handles them,
    // and mapping US -> en would override a Spanish/Chinese browser.
    var COUNTRY_LANGUAGE = {
        ES: 'es', MX: 'es', AR: 'es', CL: 'es', CO: 'es', PE: 'es', VE: 'es', CU: 'es',
        DO: 'es', PR: 'es', GT: 'es', HN: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es',
        EC: 'es', BO: 'es', PY: 'es', UY: 'es',
        PT: 'pt', BR: 'pt',
        PL: 'pl',
        DE: 'de', AT: 'de', CH: 'de', LI: 'de',
        IT: 'it', SM: 'it', VA: 'it',
        CN: 'zh', TW: 'zh-Hant', HK: 'zh-Hant', SG: 'zh',
        VN: 'vi',
        FR: 'fr', BE: 'fr', CA: 'fr', LU: 'fr', MC: 'fr', SN: 'fr',
        RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru',
        NL: 'nl', SE: 'sv', DK: 'da', NO: 'no', FI: 'fi', IS: 'is', TR: 'tr',
        CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', UA: 'uk', RS: 'sr',
        HR: 'hr', SI: 'sl', BA: 'bs', MK: 'mk', AL: 'sq', GR: 'el',
        IL: 'he', SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar',
        JO: 'ar', LB: 'ar', KW: 'ar', QA: 'ar', BH: 'ar', OM: 'ar', YE: 'ar',
        SY: 'ar', IQ: 'ar', LY: 'ar',
        IR: 'fa', BD: 'bn', LK: 'si', NP: 'ne', TH: 'th',
        JP: 'ja', KR: 'ko', ID: 'id', AD: 'ca', LT: 'lt', LV: 'lv', EE: 'et',
        GE: 'ka', AM: 'hy', AZ: 'az', MN: 'mn', UZ: 'uz', KH: 'km', MM: 'my',
        ET: 'am'
    };

    // Languages with a shipped locale file. Order is irrelevant; settings sorts
    // by native name. Add a code here only after BOTH locale files exist.
    var SHIPPED = [
        'en', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'ru', 'vi', 'zh', 'zh-Hant',
        'nl', 'sv', 'da', 'no', 'tr', 'ro', 'hu', 'cs', 'sk', 'bg', 'uk',
        'sr', 'hr', 'sl', 'el', 'he', 'ar', 'hi', 'bn', 'ta', 'ne', 'ur',
        'th', 'ja', 'ko', 'id', 'ms', 'tl', 'sw'
    ];

    // ISO 639-1 base code. Handles pt-BR / zh-Hans / en_US plus the legacy
    // codes browsers still emit and the 3-letter codes a few keyboards use.
    function normalizeLang(code) {
        if (!code || typeof code !== 'string') return '';
        var lower = code.toLowerCase().replace(/_/g, '-');
        // Traditional Chinese is a real shipped locale (zh-Hant.json), not a
        // region variant of zh.json. Check it before the base-code split.
        if (lower === 'zh-hant' || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') {
            return 'zh-Hant';
        }
        var base = lower.split('-')[0];
        if (base === 'iw') return 'he';
        if (base === 'in') return 'id';
        if (base === 'nb' || base === 'nn') return 'no';
        if (base === 'fil') return 'tl';
        return base;
    }

    function getLanguage(code) {
        return LANGUAGE_BY_CODE[normalizeLang(code)] || null;
    }

    function isShipped(code) {
        return SHIPPED.indexOf(normalizeLang(code)) !== -1;
    }

    function shippedLanguages() {
        var out = [];
        for (var i = 0; i < SHIPPED.length; i++) {
            if (LANGUAGE_BY_CODE[SHIPPED[i]]) out.push(LANGUAGE_BY_CODE[SHIPPED[i]]);
        }
        return out;
    }

    function countryLanguage(countryCode) {
        if (!countryCode) return '';
        return COUNTRY_LANGUAGE[String(countryCode).toUpperCase()] || '';
    }

    function readStoredLocation() {
        try {
            var raw = localStorage.getItem('rekindle_location_manual');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    // Country first (Kindles often report en-US), then the browser, then English.
    // A match is only used when that language actually has locale files.
    function resolveAuto(countryCode, browserLang) {
        var byCountry = countryLanguage(countryCode);
        if (byCountry && isShipped(byCountry)) return byCountry;
        var byBrowser = normalizeLang(browserLang);
        if (byBrowser && isShipped(byBrowser)) return byBrowser;
        return 'en';
    }

    // The language this device should use: an explicit saved choice when it is
    // shipped, otherwise Auto (saved location -> browser -> English).
    function currentLanguage() {
        var stored = null;
        try { stored = localStorage.getItem('rekindle_language'); } catch (e) { /* private mode */ }
        if (stored && stored !== 'auto') {
            var chosen = normalizeLang(stored);
            return isShipped(chosen) ? chosen : 'en';
        }
        var loc = readStoredLocation();
        return resolveAuto(loc && loc.country_code, navigator.language);
    }

    var registry = {
        list: LANGUAGES,
        languages: LANGUAGE_BY_CODE,
        countries: COUNTRY_LANGUAGE,
        shipped: SHIPPED.slice(),
        normalize: normalizeLang,
        get: getLanguage,
        isShipped: isShipped,
        shippedLanguages: shippedLanguages,
        countryLanguage: countryLanguage,
        resolveAuto: resolveAuto,
        current: currentLanguage,
        direction: function (code) {
            var meta = getLanguage(code);
            return (meta && meta.dir) || 'ltr';
        }
    };

    if (typeof window !== 'undefined') window.rekindleLanguages = registry;
    // Node (scripts/test-locales.js) gets the registry without the DOM loader.
    if (typeof module === 'object' && module && module.exports) {
        module.exports = registry;
        return;
    }
    if (typeof window === 'undefined') return;

    /* ------------------------------------------------------------------
     * BROWSER LOADER
     * ---------------------------------------------------------------- */

    // 1. Detect Language. ?lang= is a QA override and skips the shipped check
    //    (a locale file can be previewed before it is added to SHIPPED).
    var urlParams = new URLSearchParams(window.location.search);
    var requestedLang = urlParams.get('lang');
    var lang;
    if (requestedLang && requestedLang !== 'auto') {
        lang = normalizeLang(requestedLang) || 'en';
    } else {
        lang = currentLanguage();
    }

    // Set lang/dir synchronously so consumers that read <html lang> before the
    // locale fetch resolves (social language gating, screen readers) see the
    // resolved language rather than the markup's initial "en".
    document.documentElement.lang = lang;
    document.documentElement.dir = registry.direction(lang);

    // 2. Detect Extra Localization File
    var mainScript = document.currentScript || document.querySelector('script[src*="i18n.js"]');
    var extraPrefix = mainScript ? mainScript.getAttribute('data-i18n-file') : null;

    // 3. Expose Globals (Must happen BEFORE the async fetch)
    window.rekindleTranslations = window.rekindleTranslations || {};
    window.t = function (key, defaultText) {
        if (window.rekindleTranslations && window.rekindleTranslations[key]) {
            return window.rekindleTranslations[key];
        }
        return defaultText || key;
    };

    // Locale templates may contain ${name} placeholders; the loader only does
    // a key lookup, so dynamic text must be filled explicitly. Use split/join
    // rather than String.replace so "$&" inside a value is not special.
    window.tFormat = function (key, vars, fallback) {
        var text = window.t(key, fallback || key);
        if (!vars) return text;
        for (var name in vars) {
            if (Object.prototype.hasOwnProperty.call(vars, name)) {
                text = text.split('${' + name + '}').join(String(vars[name]));
            }
        }
        return text;
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
    //
    // locales/en.json is never fetched: every data-i18n element already carries
    // English copy, and window.t() falls back to the inline default. The extra
    // file (privacy) is still fetched for English, but the main file is not.
    var files = [];
    if (lang !== 'en') files.push('locales/' + lang + '.json');
    if (extraPrefix) files.push('locales/' + extraPrefix + '-' + lang + '.json');

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

        // Apply Translations. A cached locale can resolve before <body> is
        // parsed (i18n.js often sits early in <head>), which used to leave the
        // static data-i18n markup untranslated forever. Apply once now when the
        // document is ready, and again on DOMContentLoaded if it is still
        // parsing. Existing nodes are also re-scanned when the observer starts.
        applyTranslations(translations);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                applyTranslations(translations);
            });
        }

        // Start Observer for dynamic content
        initObserver(translations);

        // lang/dir were set synchronously before the fetch; nothing to do here.
        // (Kept as a marker for the RTL note: registry.direction() drives dir.)
        if (document.body) {
            document.body.classList.add('lang-' + lang);
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                document.body.classList.add('lang-' + lang);
            });
        }

        // Save choice (only if not in auto mode)
        // If current setting is null, treating it as 'auto', so DO NOT save 'en' over it.
        var currentSetting = localStorage.getItem('rekindle_language');
        if (currentSetting && currentSetting !== 'auto') {
            localStorage.setItem('rekindle_language', lang);
        }

        notifyReady();
    }).catch(function (e) {
        console.error('i18n error:', e);
        notifyReady(); // Continue even on error to unblock app
    });

    var I18N_SELECTOR = '[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-only], [data-i18n-html]';

    function hasI18nAttr(el) {
        return !!(el.getAttribute('data-i18n') || el.getAttribute('data-i18n-placeholder') ||
            el.getAttribute('data-i18n-title') || el.getAttribute('data-i18n-only') ||
            el.getAttribute('data-i18n-html'));
    }

    // Cheap pre-check for the MutationObserver: most inserted nodes are leaves
    // with no i18n attributes, so skip them without running a selector scan.
    function needsTranslation(node, haveTranslations) {
        if (hasI18nAttr(node)) return true;
        if (!node.firstElementChild) return false;
        if (!haveTranslations) {
            // Nothing to translate, but data-i18n-only still needs applying.
            return !!(node.querySelector && node.querySelector('[data-i18n-only]'));
        }
        return !!(node.querySelector && node.querySelector(I18N_SELECTOR));
    }

    function applyTranslations(t, root) {
        root = root || document;

        var translate = function (el) {
            var k1 = el.getAttribute('data-i18n');
            if (k1 && t[k1]) el.innerText = t[k1];
            var k2 = el.getAttribute('data-i18n-placeholder');
            if (k2 && t[k2]) el.setAttribute('placeholder', t[k2]);
            var k3 = el.getAttribute('data-i18n-title');
            if (k3 && t[k3]) el.title = t[k3];
            var k4 = el.getAttribute('data-i18n-only');
            if (k4) el.style.display = (k4 === lang) ? '' : 'none';
            var k5 = el.getAttribute('data-i18n-html');
            if (k5 && t[k5]) el.innerHTML = t[k5];
        };

        var els = root.querySelectorAll ? root.querySelectorAll(I18N_SELECTOR) : [];
        for (var i = 0; i < els.length; i++) translate(els[i]);
        if (root !== document && root.getAttribute && hasI18nAttr(root)) {
            translate(root);
        }
    }


    // 5. Dynamic Content Observer
    function initObserver(translations) {
        if (typeof MutationObserver === 'undefined') return;

        var startObserver = function () {
            if (!document.body) return;
            var haveTranslations = false;
            for (var key in translations) {
                if (translations.hasOwnProperty(key)) { haveTranslations = true; break; }
            }
            var observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    mutation.addedNodes.forEach(function (node) {
                        if (node.nodeType === 1 && needsTranslation(node, haveTranslations)) {
                            applyTranslations(translations, node);
                        }
                    });
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Catch markup that was parsed before this observer existed.
            applyTranslations(translations);
        };

        if (document.body) {
            startObserver();
        } else {
            document.addEventListener('DOMContentLoaded', startObserver);
        }
    }

})();
