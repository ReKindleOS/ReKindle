/**
 * ReKindle Pro Gate
 * Universal server-side protection for Pro apps.
 * 
 * Usage:
 *   <script src="pro-gate.js"></script>
 *   <script>
 *     window.onload = () => rekindleProGate.check();
 *   </script>
 */

(function () {
    const CACHE_KEY = 'rekindle_pro_expiry';
    const CACHE_DURATION = 1000 * 60 * 60; // 1 hour max cache

    const firebaseConfig = {
        apiKey: "AIzaSyDY7x7vVmlYUyVZNLuCCmIQYa6PWFVfZqQ",
        authDomain: "rekindle-dd1fa.firebaseapp.com",
        projectId: "rekindle-dd1fa",
        storageBucket: "rekindle-dd1fa.firebasestorage.app",
        messagingSenderId: "748026882518",
        appId: "1:748026882518:web:6877dd4329318070c11c77",
        databaseURL: "https://rekindle-dd1fa-default-rtdb.firebaseio.com/"
    };

    let isPro = false;
    let currentUser = null;
    let checkComplete = false;
    let lastPaywallStatus = 'Subscription required.';
    let paywallI18nBound = false;

    function initFirebase() {
        if (typeof firebase === 'undefined') return false;
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        return true;
    }

    function paywallText(key, fallback) {
        if (typeof window.t === 'function') return window.t(key, fallback);
        return fallback;
    }

    // The global dark-mode filter inverts a black scrim into a bright white
    // wash. Feed it white instead under dark mode so it still dims the page.
    function paywallScrim() {
        if (document.documentElement.getAttribute('data-theme') !== 'dark') {
            return 'rgba(0,0,0,0.45)';
        }
        return 'rgba(255,255,255,0.55)';
    }

    function ensurePaywallStyles() {
        if (document.getElementById('rk-paywall-styles')) return;
        const style = document.createElement('style');
        style.id = 'rk-paywall-styles';
        style.textContent = [
            '#paywall-overlay{position:fixed!important;top:0!important;left:0!important;width:100%!important;height:100%!important;',
            'background:rgba(0,0,0,0.45)!important;z-index:2147483647!important;flex-direction:column!important;',
            'align-items:center!important;justify-content:center!important;padding:20px!important;box-sizing:border-box!important;',
            'visibility:visible!important;opacity:1!important;transform:none!important;clip-path:none!important;clip:auto!important;}',
            '#paywall-overlay .rk-paywall-card{width:100%;max-width:400px;background:#fff;border:2px solid #000;',
            'box-shadow:6px 6px 0 #000;color:#000;font-family:"Geneva","Verdana",sans-serif;text-align:left;box-sizing:border-box;}',
            '#paywall-overlay .rk-paywall-bar{height:34px;border-bottom:2px solid #000;display:flex;align-items:center;',
            'justify-content:center;background:#fff;position:relative;box-sizing:border-box;}',
            '#paywall-overlay .rk-paywall-stripes{position:absolute;top:4px;bottom:4px;left:4px;right:4px;',
            'background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,#000 3px,#000 4px);z-index:0;}',
            '#paywall-overlay .rk-paywall-title{background:#fff;padding:0 12px;font-weight:bold;font-size:1rem;',
            'position:relative;z-index:1;display:inline-flex;align-items:center;height:100%;box-sizing:border-box;border:none;}',
            '#paywall-overlay .rk-paywall-body{padding:20px 20px 16px;box-sizing:border-box;text-align:center;}',
            '#paywall-overlay .rk-paywall-head{font-size:1.15rem;line-height:1.25;font-weight:bold;margin:0 0 8px;color:#000;}',
            '#paywall-overlay .rk-paywall-desc{font-size:0.82rem;line-height:1.4;color:#333;max-width:300px;margin:0 auto 16px;}',
            '#paywall-overlay .rk-paywall-primary,#paywall-overlay .rk-paywall-secondary{display:block;width:100%;',
            'min-height:48px;padding:8px 12px;border:2px solid #000;border-radius:0;box-shadow:2px 2px 0 #000;',
            'margin:0;font-family:inherit;font-size:0.92rem;font-weight:bold;line-height:1.2;cursor:pointer;box-sizing:border-box;}',
            '#paywall-overlay .rk-paywall-primary{background:#000;color:#fff;}',
            '#paywall-overlay .rk-paywall-primary:active{background:#fff;color:#000;box-shadow:none;transform:translate(2px,2px);}',
            '#paywall-overlay .rk-paywall-secondary{margin-top:8px;background:#fff;color:#000;}',
            '#paywall-overlay .rk-paywall-secondary:active{background:#000;color:#fff;box-shadow:none;transform:translate(2px,2px);}',
            '#paywall-overlay .rk-paywall-status{font-size:0.72rem;line-height:1.3;color:#555;margin:12px 0 0;min-height:1em;}',
            ':root[data-theme="dark"] #paywall-overlay{background:' + paywallScrim() + '!important;}',
            ':root[data-theme="dark"] .rk-paywall-desc,:root[data-theme="dark"] .rk-paywall-status{color:#333;}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    function renderPaywall(message) {
        lastPaywallStatus = message || lastPaywallStatus;
        ensurePaywallStyles();

        let overlay = document.getElementById('paywall-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'paywall-overlay';
            document.body.appendChild(overlay);
        }

        // Keep display:flex and the exact inline z-index: the anti-tamper
        // interval below checks both values.
        overlay.style.cssText = 'display:flex!important;position:fixed!important;top:0!important;left:0!important;' +
            'width:100%!important;height:100%!important;background:' + paywallScrim() + '!important;' +
            'z-index:2147483647!important;flex-direction:column!important;align-items:center!important;' +
            'justify-content:center!important;padding:20px!important;box-sizing:border-box!important;' +
            'visibility:visible!important;opacity:1!important;transform:none!important;clip-path:none!important;clip:auto!important;';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        overlay.innerHTML = '<div class="rk-paywall-card">' +
            '<div class="rk-paywall-bar"><div class="rk-paywall-stripes"></div>' +
            '<span class="rk-paywall-title">' + paywallText('paywall.title', 'ReKindle+') + '</span></div>' +
            '<div class="rk-paywall-body">' +
            '<h2 class="rk-paywall-head">' + paywallText('paywall.unlock', 'Unlock ReKindle+') + '</h2>' +
            '<p class="rk-paywall-desc">' + paywallText('paywall.desc', 'Support ReKindle development and get access to exclusive apps.') + '</p>' +
            '<button type="button" class="rk-paywall-primary" onclick="window.location.href=\'pay.html\'">' +
            paywallText('btn.subscribe', 'Subscribe / Login') + '</button>' +
            '<button type="button" class="rk-paywall-secondary" onclick="window.location.href=\'index\'">' +
            paywallText('common.back', 'Back') + '</button>' +
            '<p class="rk-paywall-status" id="paywall-status">' + lastPaywallStatus + '</p>' +
            '</div></div>';

        if (!paywallI18nBound) {
            paywallI18nBound = true;
            document.addEventListener('rekindle:i18n:ready', function () {
                const el = document.getElementById('paywall-overlay');
                if (el && el.style.display !== 'none') renderPaywall(lastPaywallStatus);
            });
        }
    }

    function showPaywall(message = 'Subscription required.') {
        renderPaywall(message);
    }

    function hidePaywall() {
        const overlay = document.getElementById('paywall-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function updateStatus(message) {
        const status = document.getElementById('paywall-status');
        if (status) status.innerText = message;
    }

    async function checkProStatus(user) {
        if (!user) {
            isPro = false;
            showPaywall('Please log in to access this app.');
            return false;
        }

        const db = firebase.firestore();

        try {
            const doc = await db.collection('users').doc(user.uid).get();

            if (doc.exists) {
                const data = doc.data();
                const now = Date.now();
                let expires = 0;

                if (data.proExpiresAt) {
                    expires = typeof data.proExpiresAt.toMillis === 'function'
                        ? data.proExpiresAt.toMillis()
                        : new Date(data.proExpiresAt).getTime();
                }

                if (expires > now) {
                    // User is Pro!
                    const wasPro = localStorage.getItem(CACHE_KEY);
                    localStorage.setItem(CACHE_KEY, expires.toString());
                    isPro = true;
                    hidePaywall();

                    // If they weren't pro in the last hour, force a token refresh to pick up custom claims
                    if (!wasPro && user) {
                        console.log("Pro status newly detected, refreshing token...");
                        user.getIdToken(true).catch(err => console.error("Pro gate token refresh failed:", err));
                    }

                    return true;
                } else {
                    localStorage.removeItem(CACHE_KEY);
                    isPro = false;
                    showPaywall(expires > 0 ? 'Subscription expired.' : 'Subscription required.');
                    return false;
                }
            } else {
                isPro = false;
                showPaywall('Subscription required.');
                return false;
            }
        } catch (e) {
            console.error('Pro gate check failed:', e);
            isPro = false;
            showPaywall('Error verifying subscription.');
            return false;
        }
    }

    function check(callback) {
        // 1. Initialize Firebase BEFORE the cache shortcut. Pro apps run their
        // own init inside this callback and many call firebase.auth()/
        // firestore() synchronously; if the cached `rekindle_pro_expiry` hit
        // first, those pages threw "No Firebase App '[DEFAULT]' has been
        // created" and showed their login screen to returning Pro users.
        if (!initFirebase()) {
            showPaywall('Error: Firebase not loaded.');
            if (callback) callback(false);
            return;
        }

        // 2. Quick cache check
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached && parseInt(cached) > Date.now()) {
                isPro = true;
                hidePaywall();
                if (callback) callback(true);
                // Still verify in background
            }
        } catch (e) { }

        // 3. Wait for auth
        firebase.auth().onAuthStateChanged(async (user) => {
            currentUser = user;
            const result = await checkProStatus(user);
            checkComplete = true;
            if (callback) callback(result);
        });
    }

    // Anti-tamper enforcer
    const maliciousPatterns = [
        /#paywall-overlay\s*\{[^}]*display\s*:\s*none/i,
        /\.pro-locked\s*\{[^}]*display\s*:\s*none/i,
        /\.plus-label\s*\{[^}]*display\s*:\s*none/i
    ];

    setInterval(() => {
        // 1. Overlay integrity check
        if (checkComplete && !isPro) {
            const overlay = document.getElementById('paywall-overlay');
            if (!overlay || 
                overlay.style.display === 'none' || 
                overlay.style.visibility === 'hidden' || 
                overlay.style.opacity === '0' ||
                overlay.style.zIndex !== '2147483647') {
                showPaywall('Subscription required.');
            }
        }

        // 2. Detect and remove injected malicious styles
        const styles = document.querySelectorAll('style');
        styles.forEach(style => {
            const text = style.textContent || style.innerText || '';
            for (const pattern of maliciousPatterns) {
                if (pattern.test(text)) {
                    console.warn('[ReKindle Anti-Tamper] Removing malicious style injection.');
                    style.remove();
                    if (checkComplete && !isPro) showPaywall('Subscription required.');
                }
            }
        });

        // 3. Detect if rekindleProGate API has been tampered with
        if (!window.rekindleProGate || 
            typeof window.rekindleProGate.check !== 'function' ||
            typeof window.rekindleProGate.isPro !== 'function') {
            console.warn('[ReKindle Anti-Tamper] API tampering detected. Re-establishing...');
            window.rekindleProGate = {
                check: check,
                isPro: () => isPro,
                getUser: () => currentUser,
                showPaywall: showPaywall,
                hidePaywall: hidePaywall
            };
            if (checkComplete && !isPro) showPaywall('Subscription required.');
        }

        // 4. Detect global isPro locking (userscript pattern)
        const isProDesc = Object.getOwnPropertyDescriptor(window, 'isPro');
        if (isProDesc && (isProDesc.get || isProDesc.set) && !isProDesc.configurable) {
            console.warn('[ReKindle Anti-Tamper] Global isPro has been locked by external script.');
            // We can't unlock it, but we can force the paywall back
            if (checkComplete && !isPro) showPaywall('Subscription required.');
        }
    }, 500);

    // Expose API
    window.rekindleProGate = {
        check: check,
        isPro: () => isPro,
        getUser: () => currentUser,
        showPaywall: showPaywall,
        hidePaywall: hidePaywall
    };

    // AUTO-RUN after window fully loads (gives apps time to init Firebase first)
    window.addEventListener('load', () => {
        // Small delay to ensure app's onload runs first
        setTimeout(() => check(), 100);
    });
})();
