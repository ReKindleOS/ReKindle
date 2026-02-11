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

    function initFirebase() {
        if (typeof firebase === 'undefined') return false;
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        return true;
    }

    function showPaywall(message = 'Subscription required.') {
        let overlay = document.getElementById('paywall-overlay');
        if (!overlay) {
            // Create overlay if not exists
            overlay = document.createElement('div');
            overlay.id = 'paywall-overlay';
            overlay.style.cssText = 'display:flex; position:fixed; top:35px; left:0; width:100%; height:calc(100% - 35px); background:rgba(255,255,255,0.98); z-index:9000; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:20px; box-sizing:border-box;';
            overlay.innerHTML = `
                <h2 style="margin-top:0;">ReKindle+</h2>
                <p>Support ReKindle development and get<br>access to exclusive apps.</p>
                <button onclick="window.location.href='pay.html'" style="padding:12px 32px; cursor:pointer; font-size:1.1rem; font-weight:bold; font-family:inherit; background:#fff; border:2px solid #000; color:#000;">Subscribe / Login</button>
                <p style="font-size:0.8rem; margin-top:20px; color:#666;" id="paywall-status">${message}</p>
            `;
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
            const status = document.getElementById('paywall-status');
            if (status) status.innerText = message;
        }
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
                    localStorage.setItem(CACHE_KEY, expires.toString());
                    isPro = true;
                    hidePaywall();
                    return true;
                } else {
                    localStorage.removeItem(CACHE_KEY);
                    showPaywall(expires > 0 ? 'Subscription expired.' : 'Subscription required.');
                    return false;
                }
            } else {
                showPaywall('Subscription required.');
                return false;
            }
        } catch (e) {
            console.error('Pro gate check failed:', e);
            showPaywall('Error verifying subscription.');
            return false;
        }
    }

    function check(callback) {
        // 1. Quick cache check
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached && parseInt(cached) > Date.now()) {
                isPro = true;
                hidePaywall();
                if (callback) callback(true);
                // Still verify in background
            }
        } catch (e) { }

        // 2. Initialize Firebase
        if (!initFirebase()) {
            showPaywall('Error: Firebase not loaded.');
            if (callback) callback(false);
            return;
        }

        // 3. Wait for auth
        firebase.auth().onAuthStateChanged(async (user) => {
            currentUser = user;
            const result = await checkProStatus(user);
            if (callback) callback(result);
        });
    }

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
