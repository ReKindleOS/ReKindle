/* ReKindle home screen logic (extracted from index.html 2026-11-24). */
    (function() {
        // Note: Global variables and logic mostly unchanged, specific fixes applied inside functions.
        let currentFilter = 'all';
        let currentUser = null;
        let gamesDisabled = false;
        let favoriteApps = [];
        let hiddenApps = [];
        let featuredHidden = localStorage.getItem('rekindle_featured_hidden') === 'true';
        let recentHidden = localStorage.getItem('rekindle_recent_hidden') === 'true';

        try {
            const cached = JSON.parse(localStorage.getItem('rekindle_favorites'));
            if (Array.isArray(cached)) {
                favoriteApps = cached || [];
                hiddenApps = [];
            } else if (cached) {
                favoriteApps = cached.favorites || [];
                hiddenApps = cached.hidden || [];
            } else {
                favoriteApps = [];
                hiddenApps = [];
            }
        } catch (e) {
            console.error("Error loading favorites from cache", e);
            favoriteApps = [];
            hiddenApps = [];
        }

        let isEditMode = false;
        let isFirebaseAvailable = false;
        let isPro = (localStorage.getItem('rekindle_is_pro') === 'true');
        const ALLOWED_EXIT_AGENT = "MY_CUSTOM_AGENT";

        let auth = null;
        let db = null;
        let rtdb = null;
        let authSdkPromise = null;
        let firebaseAuthPromise = null;
        let firestorePromise = null;
        let rtdbPromise = null;
        let functionsPromise = null;
        let shellReady = false;
        let authListenerAttached = false;
        let userCardsRef = null;
        let serverTimeOffset = 0;
        let appSearchQuery = '';
        let appSearchOpen = false;
        let appSearchTimer = null;
        let recentApps = [];
        let homeScrollPositions = {};
        let homeScrollTimer = null;

        try {
            const savedScroll = JSON.parse(sessionStorage.getItem('rekindle_home_scroll_v1') || '{}');
            if (savedScroll && typeof savedScroll === 'object' && !Array.isArray(savedScroll)) {
                homeScrollPositions = savedScroll;
            }
        } catch (e) { homeScrollPositions = {}; }

        try {
            const cachedRecent = JSON.parse(localStorage.getItem('rekindle_recent_apps') || '[]');
            if (Array.isArray(cachedRecent)) {
                recentApps = cachedRecent.filter(function (id) {
                    return typeof id === 'string';
                }).slice(0, 6);
            }
        } catch (e) {
            recentApps = [];
        }

        // Clock skew: use RTDB's server offset. The old HEAD-request Date header
        // could be answered from the service-worker/edge cache, so the computed
        // "offset" could be hours stale and drag the top-bar clock with it.
        function syncWithFirebaseClock() {
            if (!rtdb) return;
            try {
                rtdb.ref('.info/serverTimeOffset').on('value', function (snap) {
                    const offset = snap.val();
                    if (typeof offset === 'number' && isFinite(offset)) {
                        serverTimeOffset = offset;
                        updateTopClock();
                    }
                });
            } catch (e) {
                console.warn("Clock sync unavailable; using device time.", e);
            }
        }

        function updateTopClock() {
            const clockEl = document.getElementById('top-clock');
            if (clockEl) {
                const nowMs = Date.now() + serverTimeOffset;
                const now = (typeof rekindleGetZonedDate === 'function') ? rekindleGetZonedDate(new Date(nowMs)) : new Date(nowMs);
                let h = now.getHours();
                const m = now.getMinutes().toString().padStart(2, '0');
                const ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12;
                if (h === 0) h = 12;
                clockEl.innerText = `${h}:${m} ${ampm}`;
            }
        }
        let topClockInterval = setInterval(updateTopClock, 60000);
        updateTopClock();
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (topClockInterval) { clearInterval(topClockInterval); topClockInterval = null; }
            } else if (!topClockInterval) {
                updateTopClock();
                topClockInterval = setInterval(updateTopClock, 60000);
            }
        });
        const firebaseConfig = {
            apiKey: "AIzaSyDY7x7vVmlYUyVZNLuCCmIQYa6PWFVfZqQ",
            authDomain: "rekindle-dd1fa.firebaseapp.com",
            projectId: "rekindle-dd1fa",
            storageBucket: "rekindle-dd1fa.firebasestorage.app",
            messagingSenderId: "748026882518",
            appId: "1:748026882518:web:6877dd4329318070c11c77"
        };

        // --- LIVE LOBBY VALIDATION ---
        // Validates matchmaking entries against the actual game node (games/{gameType}/{matchId}).
        // presence/{uid} alone cannot detect stale lobbies: a user online anywhere in the app
        // keeps presence=true even after abandoning a lobby (cancelled onDisconnect, crashes,
        // host migration that missed the listing update), which left phantom entries in Live Games.
        // Cost is identical to the old presence check: one read per waiting match.
        const matchValidationCache = new Map(); // "gameType/matchId" -> { result, ts }
        const MATCH_VALIDATION_TTL = 30000;
        const mmCleanupAttempted = new Set();
        const mmHealAttempted = new Map(); // key -> hostUid last healed to

        function isHumanLobbyPlayer(players, uid) {
            const p = players[uid];
            return !!(p && !p.isBot && uid.indexOf('bot_') !== 0);
        }

        function cleanupMatchmaking(gameType, matchId) {
            const key = gameType + '/' + matchId;
            if (mmCleanupAttempted.has(key)) return;
            mmCleanupAttempted.add(key);
            rtdb.ref('matchmaking/' + key).remove().catch(() => { });
        }

        function healMatchmakingHost(gameType, matchId, hostUid, hostName) {
            const key = gameType + '/' + matchId;
            if (mmHealAttempted.get(key) === hostUid) return;
            mmHealAttempted.set(key, hostUid);
            rtdb.ref('matchmaking/' + key).update({ hostUid: hostUid, hostName: hostName }).catch(() => { });
        }

        // Returns { valid, hostUid, hostName, error }. hostUid/hostName reflect the true current
        // host, which may differ from the listing when the lobby healed after a host change.
        async function validateLiveMatch(gameType, matchId, match) {
            try {
                let snap = await rtdb.ref('games/' + gameType + '/' + matchId).once('value');
                let game = snap.val();
                if (!game) {
                    // Hosts write the matchmaking entry a tick before the game node, so
                    // re-check once before declaring the listing dead.
                    await new Promise(r => setTimeout(r, 3000));
                    snap = await rtdb.ref('games/' + gameType + '/' + matchId).once('value');
                    game = snap.val();
                    if (!game) {
                        cleanupMatchmaking(gameType, matchId);
                        return { valid: false };
                    }
                }
                if (game.status !== 'lobby') {
                    // Match already started/finished but the listing was never removed.
                    cleanupMatchmaking(gameType, matchId);
                    return { valid: false };
                }
                const players = game.players || {};
                const humans = Object.keys(players).filter(uid => isHumanLobbyPlayer(players, uid));
                if (humans.length === 0) {
                    // Lobby with nobody in it (ghost players from abrupt disconnects).
                    cleanupMatchmaking(gameType, matchId);
                    return { valid: false };
                }
                if (!match.hostUid || !isHumanLobbyPlayer(players, match.hostUid)) {
                    // Listed host is gone and host migration missed the listing update.
                    let newHost = isHumanLobbyPlayer(players, game.host) ? game.host : null;
                    if (!newHost) {
                        humans.sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0));
                        newHost = humans[0];
                    }
                    const newName = players[newHost].name || 'Someone';
                    healMatchmakingHost(gameType, matchId, newHost, newName);
                    return { valid: true, hostUid: newHost, hostName: newName };
                }
                return { valid: true, hostUid: match.hostUid, hostName: match.hostName };
            } catch (e) {
                // Transient read failure: hide (same as old presence behaviour), never clean up.
                return { valid: false, error: true };
            }
        }

        async function cachedMatchValidation(gameType, matchId, match) {
            const key = gameType + '/' + matchId;
            const cached = matchValidationCache.get(key);
            if (cached && (Date.now() - cached.ts) < MATCH_VALIDATION_TTL) return cached.result;
            const result = await validateLiveMatch(gameType, matchId, match);
            if (!result.error) {
                matchValidationCache.set(key, { result: result, ts: Date.now() });
            }
            return result;
        }

        // --- LAZY FIREBASE BOOT ---
        // The shell renders from the local scripts first; Firebase is pulled in
        // only when it is needed (auth after paint, Firestore/RTDB after a
        // session exists, Functions on login/register).
        function ensureFirebaseAuth() {
            if (auth) return Promise.resolve(auth);
            if (authSdkPromise) return authSdkPromise;
            if (!window.rekindleLoadFirebase) return Promise.reject(new Error('Firebase loader missing'));
            authSdkPromise = window.rekindleLoadFirebase(['auth'], firebaseConfig).then(function () {
                auth = firebase.auth();
                isFirebaseAvailable = true;
                return auth;
            }).catch(function (err) {
                authSdkPromise = null;
                throw err;
            });
            return authSdkPromise;
        }

        function ensureFirestore() {
            if (db) return Promise.resolve(db);
            if (firestorePromise) return firestorePromise;
            firestorePromise = window.rekindleLoadFirebase(['firestore'], firebaseConfig).then(function () {
                db = firebase.firestore();
                return db;
            }).catch(function (err) {
                firestorePromise = null;
                throw err;
            });
            return firestorePromise;
        }

        function ensureRtdb() {
            if (rtdb) return Promise.resolve(rtdb);
            if (rtdbPromise) return rtdbPromise;
            rtdbPromise = window.rekindleLoadFirebase(['database'], firebaseConfig).then(function () {
                rtdb = firebase.database();
                window.rtdb = rtdb;
                syncWithFirebaseClock();
                return rtdb;
            }).catch(function (err) {
                rtdbPromise = null;
                throw err;
            });
            return rtdbPromise;
        }

        function ensureFirebaseFunctions() {
            if (!functionsPromise) {
                functionsPromise = window.rekindleLoadFirebase(['functions'], firebaseConfig).catch(function (err) {
                    functionsPromise = null;
                    throw err;
                });
            }
            return functionsPromise;
        }

        function hasStoredSession() {
            try { return !!localStorage.getItem('rekindle_uid'); } catch (e) { return false; }
        }

        function scheduleAuthBoot() {
            // A guest who never signs in downloads no Firebase code at all.
            // A returning user has a uid cache, so restore their session in the
            // background after the grid is interactive.
            if (!hasStoredSession()) return;
            const run = function () { bootFirebaseAuth(); };
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(run, { timeout: 2500 });
            } else {
                setTimeout(run, 400);
            }
        }

        function watchUserCard(uid) {
            if (!rtdb) return;
            if (userCardsRef) {
                try { userCardsRef.off(); } catch (e) { }
                userCardsRef = null;
            }
            userCardsRef = rtdb.ref('user_cards/' + uid);
            userCardsRef.on('value', function (snap) {
                if (snap.exists()) {
                    const card = snap.val();
                    const avatarSeed = card.customAvatar || card.avatarSeed || uid;
                    drawAvatar('user-badge-icon', avatarSeed);
                    window.rekindleInvalidateUserCard && window.rekindleInvalidateUserCard(uid);
                } else {
                    drawAvatar('user-badge-icon', uid);
                }
            });
        }

        function initLiveBadge() {
            if (!rtdb || window._badgeAttach) return;
            let badgeListener = null;
            let badgeListenerRef = null;
            let badgeDebounceTimer = null;

            function attachBadgeListener() {
                if (badgeListener) return;
                // matchmaking requires auth in rtdb-rules; attaching while
                // signed out only produces a permission error.
                if (!window._rekindleAuthedUid) return;
                badgeListenerRef = rtdb.ref('matchmaking');
                badgeListener = badgeListenerRef.on('value', (snap) => {
                    // Debounce rapid deltas (5s) to reduce GC churn
                    clearTimeout(badgeDebounceTimer);
                    badgeDebounceTimer = setTimeout(async () => {
                        let count = 0;
                        if (snap.exists()) {
                            const games = snap.val();
                            const checks = [];
                            for (const gameType in games) {
                                for (const matchId in games[gameType]) {
                                    const match = games[gameType][matchId];
                                    if (match && match.status === 'waiting') {
                                        checks.push(cachedMatchValidation(gameType, matchId, match));
                                    }
                                }
                            }
                            const results = await Promise.all(checks);
                            count = results.filter(r => r && r.valid).length;
                        }
                        const badge = document.getElementById('live-games-count');
                        if (badge) {
                            badge.innerText = count;
                            badge.style.display = count > 0 ? 'inline-flex' : 'none';
                        }
                    }, 5000);
                });
            }

            function detachBadgeListener() {
                clearTimeout(badgeDebounceTimer);
                if (badgeListenerRef && badgeListener) {
                    badgeListenerRef.off('value', badgeListener);
                    badgeListener = null;
                    badgeListenerRef = null;
                }
            }

            attachBadgeListener();
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) detachBadgeListener();
                else attachBadgeListener();
            });
            window.addEventListener('pagehide', detachBadgeListener);
            window._badgeDetach = detachBadgeListener;
            window._badgeAttach = attachBadgeListener;
            window._matchValidationCache = matchValidationCache;
        }

        function handleOfflineMode() {
            window._rekindleAuthedUid = null;
            const userDisplay = document.getElementById('user-display');
            if (userDisplay) userDisplay.innerText = 'Offline Mode';
        }

        function handleAuthState(user, previousUid) {
            if (!user) {
                handleGuestMode();
                return;
            }
            if (previousUid && previousUid !== user.uid) {
                clearServiceWorkerCache();
            }
            currentUser = user;
            window._rekindleAuthedUid = user.uid;
            agendaMonthCache = {};
            try { localStorage.setItem('rekindle_uid', user.uid); } catch (e) { /* storage disabled */ }
            let displayUser = user.email ? user.email.split('@')[0] : 'Account';
            if (user.email && user.email.endsWith('@rekindle.ink')) {
                displayUser = user.email.replace('@rekindle.ink', '');
            }
            // Remember the name so the "session ended unexpectedly" prompt can
            // pre-fill the login form (see handleGuestMode).
            try { localStorage.setItem('rekindle_last_username', displayUser); } catch (e) { /* storage disabled */ }

            const badge = document.getElementById('user-badge');
            if (badge) badge.onclick = function () { location.href = 'neighbourhood?uid=' + user.uid; };
            const userDisplay = document.getElementById('user-display');
            if (userDisplay) userDisplay.innerText = displayUser;
            const authBtn = document.getElementById('auth-btn');
            if (authBtn) {
                authBtn.innerText = 'Log Out';
                authBtn.onclick = openLogoutModal;
            }
            const modalAuthBtn = document.getElementById('modal-auth-btn');
            if (modalAuthBtn) {
                modalAuthBtn.innerText = 'Log Out';
                modalAuthBtn.onclick = openLogoutModal;
            }
            closeModal('login-modal');

            try {
                const cachedFavs = localStorage.getItem('rekindle_favorites');
                if (cachedFavs) {
                    const parsed = JSON.parse(cachedFavs);
                    if (Array.isArray(parsed)) {
                        favoriteApps = parsed;
                        hiddenApps = [];
                    } else {
                        favoriteApps = parsed.favorites || [];
                        hiddenApps = parsed.hidden || [];
                    }
                    renderFavoriteSection();
                }
            } catch (e) { console.error('Error parsing favorites cache', e); }

            // The shell is already interactive. Load the signed-in data
            // services independently: a Firestore outage must not skip the
            // RTDB-backed IP check or the live badge.
            ensureFirestore().then(function () {
                if (!currentUser || currentUser.uid !== user.uid) return;
                monitorUserProfile(user.uid);
                if (currentFilter === 'dashboard') fetchDashboardAgenda(true);
            }).catch(function (err) {
                console.warn('Firestore unavailable for signed-in user:', err);
            });
            ensureRtdb().then(function () {
                if (!currentUser || currentUser.uid !== user.uid) return;
                RekindleIpBan.enforceOnAuthStateChanged(user);
                watchUserCard(user.uid);
                initLiveBadge();
                if (window._badgeAttach) window._badgeAttach();
            }).catch(function (err) {
                console.warn('RTDB unavailable for signed-in user:', err);
            });
        }

        function bootFirebaseAuth() {
            if (auth && authListenerAttached) return Promise.resolve(auth);
            if (firebaseAuthPromise) return firebaseAuthPromise;
            firebaseAuthPromise = ensureFirebaseAuth().then(function () {
                if (!authListenerAttached) {
                    authListenerAttached = true;
                    let lastUid = null;
                    try { lastUid = localStorage.getItem('rekindle_uid'); } catch (e) { /* storage disabled */ }
                    auth.onAuthStateChanged(function (user) {
                        handleAuthState(user, lastUid);
                        lastUid = user ? user.uid : null;
                    });
                }
                return auth;
            }).catch(function (err) {
                console.warn('Firebase auth unavailable; staying offline.', err);
                isFirebaseAvailable = false;
                firebaseAuthPromise = null;
                handleOfflineMode();
                return null;
            });
            return firebaseAuthPromise;
        }

        function initShell() {
            if (shellReady) return;
            shellReady = true;

            // MERGE BETA APPS
            try {
                if (typeof APPS !== 'undefined' && Array.isArray(APPS) &&
                    typeof APPS_BETA !== 'undefined' && Array.isArray(APPS_BETA) &&
                    !window.__rkBetaAppsMerged) {
                    APPS.push.apply(APPS, APPS_BETA);
                    window.__rkBetaAppsMerged = true;
                }
            } catch (e) { console.error('APPS merge failed', e); }

            checkExitButtonVisibility();
            if (window.rekindleApplyWallpaper) window.rekindleApplyWallpaper();
            gamesDisabled = areGamesDisabled();
            autoDetectScale();
            renderAboutContent();
            // No stored session means Guest Mode: never leave a previous
            // account's cached Pro flag on screen while auth is not loaded.
            if (!hasStoredSession()) {
                isPro = false;
                try { localStorage.setItem('rekindle_is_pro', 'false'); } catch (e) { /* storage disabled */ }
            }
            updateProUI();
            updateNavVisibility();

            const navAll = document.getElementById('nav-all');
            const navDash = document.getElementById('nav-dashboard');
            if (navAll) navAll.setAttribute('aria-label', window.t ? window.t('home.nav.all_apps', 'All Apps') : 'All Apps');
            if (navDash) navDash.setAttribute('aria-label', window.t ? window.t('home.nav.dashboard', 'Dashboard') : 'Dashboard');
            const guestAuthBtn = document.getElementById('auth-btn');
            if (guestAuthBtn) guestAuthBtn.innerText = window.t ? window.t('home.nav.login', 'LOG IN / REGISTER') : 'LOG IN / REGISTER';
            const guestModalBtn = document.getElementById('modal-auth-btn');
            if (guestModalBtn) guestModalBtn.innerText = window.t ? window.t('home.nav.login', 'LOG IN / REGISTER') : 'LOG IN / REGISTER';
            document.querySelectorAll('.folder-tab').forEach(function (tab) {
                tab.setAttribute('role', 'tab');
                if (!tab.hasAttribute('tabindex')) tab.setAttribute('tabindex', '0');
            });
            const tabContainer = document.querySelector('.folder-tabs-container');
            if (tabContainer && !tabContainer.__rkKeyHandler) {
                tabContainer.__rkKeyHandler = true;
                tabContainer.addEventListener('keydown', function (event) {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    const tab = event.target.closest ? event.target.closest('.folder-tab') : null;
                    if (!tab) return;
                    event.preventDefault();
                    tab.click();
                });
            }

            // Draw the neutral silhouette for the menu bar while auth resolves;
            // a real avatar replaces it in watchUserCard().
            const badgeIcon = document.getElementById('user-badge-icon');
            if (badgeIcon) drawGuestAvatar(badgeIcon);

            if (new URLSearchParams(window.location.search).get('login') === 'true') {
                openLogin();
            }

            const appView = document.querySelector('.app-view');
            if (appView) {
                appView.addEventListener('scroll', function () {
                    if (!currentFilter) return;
                    homeScrollPositions[currentFilter] = appView.scrollTop;
                    if (homeScrollTimer) clearTimeout(homeScrollTimer);
                    homeScrollTimer = setTimeout(function () { persistHomeView(); }, 250);
                }, { passive: true });
            }

            restoreHomeView();
            try {
                const searchParam = new URLSearchParams(window.location.search).get('q');
                if (searchParam) runHomeSearch(searchParam);
            } catch (e) { /* malformed URL */ }
            warmRecentApp();

            // Auth is a background upgrade: the grid is already usable.
            scheduleAuthBoot();
        }

        // Run after this script finishes evaluating: initShell reads `let`
        // bindings declared later in the file (shelf state, agenda cache), which
        // are in their temporal dead zone during a deferred script's evaluation.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initShell);
        } else {
            setTimeout(initShell, 0);
        }


        // ... [Helper functions like handleGuestMode, updateNavVisibility, etc. remain unchanged] ...

        function handleGuestMode() {
            window._rekindleAuthedUid = null;
            currentUser = null;
            agendaMonthCache = {};
            if (userCardsRef) {
                try { userCardsRef.off(); } catch (e) { /* already detached */ }
                userCardsRef = null;
            }
            if (window._badgeDetach) window._badgeDetach();
            const wasPro = isPro;
            isPro = false;
            localStorage.setItem('rekindle_is_pro', isPro.toString());

            // If this browser knew a uid, we were signed in and something ended
            // the session (a reload that beat the auth write, a revoked token,
            // an IP ban). Say so once and offer the pre-filled login instead of
            // silently resetting to Guest Mode — that silent reset is what the
            // "sign in glitch" reports described.
            let previousUid = null;
            try {
                previousUid = localStorage.getItem('rekindle_uid');
                localStorage.removeItem('rekindle_uid');
            } catch (e) { /* storage disabled */ }

            const noticeKey = 'rekindle_signout_notice';
            if (previousUid) {
                console.warn('[auth] signed-out state after a stored session (uid ' + previousUid + ')');
                let alreadyShown = null;
                try { alreadyShown = sessionStorage.getItem(noticeKey); } catch (e) { /* ignore */ }
                if (!alreadyShown) {
                    try { sessionStorage.setItem(noticeKey, '1'); } catch (e) { /* ignore */ }
                    setTimeout(function () {
                        let lastUser = '';
                        try { lastUser = localStorage.getItem('rekindle_last_username') || ''; } catch (e) { /* ignore */ }
                        const field = document.getElementById('username');
                        if (field && lastUser) field.value = lastUser;
                        showGenericModal('Signed out', 'Your session ended unexpectedly. Sign in again to keep your account loaded on this device.');
                    }, 600);
                }
            }

            document.getElementById('user-display').innerText = window.t ? window.t('home.guest_mode', 'Guest Mode') : "Guest Mode";
            document.getElementById('auth-btn').innerText = window.t ? window.t('home.nav.login', 'LOG IN / REGISTER') : "LOG IN / REGISTER";
            document.getElementById('auth-btn').onclick = openLogin;

            document.getElementById('user-badge').onclick = function () {
                location.href = 'neighbourhood';
            };

            const badgeIcon = document.getElementById('user-badge-icon');
            if (badgeIcon) {
                drawGuestAvatar(badgeIcon);
            }

            const modalAuthBtn = document.getElementById('modal-auth-btn');
            if (modalAuthBtn) {
                modalAuthBtn.innerText = window.t ? window.t('home.nav.login', 'LOG IN / REGISTER') : "LOG IN / REGISTER";
                modalAuthBtn.onclick = openLogin;
            }

            const cached = JSON.parse(localStorage.getItem('rekindle_favorites'));
            if (Array.isArray(cached)) {
                favoriteApps = cached || [];
                hiddenApps = [];
            } else if (cached) {
                favoriteApps = cached.favorites || [];
                hiddenApps = cached.hidden || [];
            } else {
                favoriteApps = [];
                hiddenApps = [];
            }

            if (wasPro) {
                renderAppGrid(currentFilter);
                if (currentFilter === 'all') renderFeaturedSection();
            }
            renderFavoriteSection();
            updateProUI();
        }

        function updateNavVisibility() {
            gamesDisabled = areGamesDisabled();
            const gameNav = document.getElementById('nav-games');
            const twoPlayerNav = document.getElementById('nav-two_player');
            if (gamesDisabled) {
                gameNav.style.display = 'none';
                twoPlayerNav.style.display = 'none';
                if (currentFilter === 'games' || currentFilter === 'two_player') {
                    filterApps('all', document.getElementById('nav-all'));
                }
            } else {
                gameNav.style.display = 'block';
                twoPlayerNav.style.display = 'block';
            }
        }

        function renderAboutContent() {
            const logoContainer = document.getElementById('logo-container');
            if (logoContainer) logoContainer.innerHTML = '<img src="logo.svg" class="keep-white" style="width:100%; height:100%;" alt="ReKindle Logo">';
            const qrContainer = document.getElementById('qr-container');
            if (qrContainer) qrContainer.innerHTML = '<img src="donate.svg" style="width:100%; height:100%;" alt="Donate QR">';
        }

        // ... [Sync functions unchanged] ...

        function syncFavorites() {
            if (!currentUser || !isFirebaseAvailable || !db) return;
            db.collection('users').doc(currentUser.uid).collection('settings').doc('favorites')
                .get().then(doc => {
                    if (doc.exists) {
                        const data = doc.data();
                        favoriteApps = data.appIds || [];
                        hiddenApps = data.hiddenIds || [];
                    } else { favoriteApps = []; hiddenApps = []; }
                    const cacheData = { favorites: favoriteApps, hidden: hiddenApps };
                    localStorage.setItem('rekindle_favorites', JSON.stringify(cacheData));
                    localStorage.setItem('rekindle_fav_last_sync', Date.now().toString());
                    renderFavoriteSection();
                    if (currentFilter === 'all') renderAppGrid('all');
                }).catch(err => console.error("Error fetching favorites:", err));
        }

        function syncGeneralSettings(serverTimestamp = null) {
            if (!currentUser || !isFirebaseAvailable || !db) return;
            db.collection('users').doc(currentUser.uid).collection('settings').doc('general').get().then(doc => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data.manualLocation) localStorage.setItem('rekindle_location_manual', JSON.stringify(data.manualLocation));
                    if (data.unitSystem) localStorage.setItem('rekindle_unit_system', data.unitSystem);
                    if (data.themeMode) {
                        localStorage.setItem('rekindle_theme_mode', data.themeMode);
                        if (window.rekindleApplyTheme) window.rekindleApplyTheme();
                    }
                    if (data.disableGames !== undefined) localStorage.setItem('rekindle_disable_games', data.disableGames);

                    if (data.defaultFullscreen !== undefined) localStorage.setItem('rekindle_default_fullscreen', data.defaultFullscreen);
                    if (data.rotation) { localStorage.setItem('rekindle_rotation', data.rotation); if (window.rekindleApplyRotation) window.rekindleApplyRotation(); }
                    if (data.customPattern && Array.isArray(data.customPattern)) {
                        localStorage.setItem('rekindle_pixel_data', JSON.stringify(data.customPattern));
                        if (window.rekindleApplyWallpaper) window.rekindleApplyWallpaper();
                    }
                    if (serverTimestamp) localStorage.setItem('rekindle_settings_last_sync', serverTimestamp.toString());
                    else localStorage.setItem('rekindle_settings_last_sync', Date.now().toString());
                }
            }).catch(err => console.error("Error fetching general settings:", err));
        }

        function monitorUserProfile(uid) {
            if (!isFirebaseAvailable || !db) return;
            db.collection('users').doc(uid).onSnapshot(doc => {
                const now = Date.now();
                let expires = 0;
                let newProStatus = false;
                let serverFavTimestamp = 0;
                let serverSettingsTimestamp = 0;

                if (doc.exists) {
                    const data = doc.data();
                    if (data.proExpiresAt) {
                        expires = typeof data.proExpiresAt.toMillis === 'function' ? data.proExpiresAt.toMillis() : new Date(data.proExpiresAt).getTime();
                    }
                    newProStatus = (expires > now);
                    if (data.favoritesLastUpdated) {
                        serverFavTimestamp = typeof data.favoritesLastUpdated.toMillis === 'function' ? data.favoritesLastUpdated.toMillis() : new Date(data.favoritesLastUpdated).getTime();
                    }
                    if (data.settingsLastUpdated) {
                        serverSettingsTimestamp = typeof data.settingsLastUpdated.toMillis === 'function' ? data.settingsLastUpdated.toMillis() : new Date(data.settingsLastUpdated).getTime();
                    }
                }

                const wasPro = isPro;
                isPro = newProStatus;
                if (wasPro !== isPro) {
                    localStorage.setItem('rekindle_is_pro', isPro.toString());
                    if (wasPro && !isPro) {
                        try { localStorage.setItem('rekindle_was_pro', 'true'); } catch (e) { }
                    } else if (isPro) {
                        try { localStorage.removeItem('rekindle_was_pro'); } catch (e) { }
                    }
                    renderAppGrid(currentFilter);
                    if (currentFilter === 'all') renderFeaturedSection();
                    renderFavoriteSection();
                    updateProUI();
                }

                const localFavTimestamp = parseInt(localStorage.getItem('rekindle_fav_last_sync') || '0');
                if (serverFavTimestamp > localFavTimestamp || localFavTimestamp === 0) {
                    syncFavorites();
                }

                const localSettingsTimestamp = parseInt(localStorage.getItem('rekindle_settings_last_sync') || '0');
                if (serverSettingsTimestamp > localSettingsTimestamp || localSettingsTimestamp === 0) {
                    syncGeneralSettings(serverSettingsTimestamp);
                }
            });
        }

        function toggleFavorite(appId, event) {
            event.preventDefault(); event.stopPropagation();
            if (favoriteApps.includes(appId)) { favoriteApps = favoriteApps.filter(id => id !== appId); }
            else {
                favoriteApps.push(appId);
                favoriteApps.sort((idA, idB) => {
                    const a = APPS.find(app => app.id === idA);
                    const b = APPS.find(app => app.id === idB);
                    if (!a) return 1; if (!b) return -1;
                    return a.name.localeCompare(b.name);
                });
                if (hiddenApps.includes(appId)) hiddenApps = hiddenApps.filter(id => id !== appId);
            }
            saveFavorites(); renderFavoriteSection(); renderAppGrid(currentFilter);
        }

        function toggleHidden(appId, event) {
            event.preventDefault(); event.stopPropagation();
            if (hiddenApps.includes(appId)) { hiddenApps = hiddenApps.filter(id => id !== appId); }
            else {
                hiddenApps.push(appId);
                if (favoriteApps.includes(appId)) favoriteApps = favoriteApps.filter(id => id !== appId);
            }
            saveFavorites(); renderFavoriteSection(); renderAppGrid(currentFilter);
        }

        function saveFavorites() {
            const cacheData = { favorites: favoriteApps, hidden: hiddenApps };
            localStorage.setItem('rekindle_favorites', JSON.stringify(cacheData));
            if (currentUser && isFirebaseAvailable && db) {
                const now = Date.now();
                localStorage.setItem('rekindle_fav_last_sync', (now + 10000).toString());
                const batch = db.batch();
                const userRef = db.collection('users').doc(currentUser.uid);
                const favRef = userRef.collection('settings').doc('favorites');
                batch.set(favRef, { appIds: favoriteApps, hiddenIds: hiddenApps });
                batch.set(userRef, { favoritesLastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                batch.commit().catch(e => console.error("Error saving favorites:", e));
            }
        }

        function renderFavoriteSection() {
            renderForYouShelf();
        }

        function toggleEditMode() {
            isEditMode = !isEditMode;
            if (appSearchOpen || appSearchQuery) resetAppSearchField();
            const btn = document.getElementById('edit-done-btn');
            const resetBtn = document.getElementById('reset-btn');
            const featToggle = document.getElementById('featured-toggle-btn');
            const recentToggle = document.getElementById('recent-toggle-btn');
            const searchToggle = document.getElementById('app-search-toggle');
            if (searchToggle) searchToggle.style.display = isEditMode ? 'none' : 'flex';
            if (isEditMode) {
                btn.innerText = window.t('home.btn.done', 'Done');
                if (resetBtn) resetBtn.style.display = 'inline-flex';
                if (recentToggle) {
                    recentToggle.style.display = 'inline-flex';
                    updateRecentToggleLabel();
                }
                if (featToggle) {
                    featToggle.style.display = 'inline-flex';
                    const key = featuredHidden ? 'home.btn.featured_off' : 'home.btn.featured_on';
                    const def = featuredHidden ? 'Featured: OFF' : 'Featured: ON';
                    featToggle.innerText = window.t ? window.t(key, def) : def;
                }
                document.querySelectorAll('.favorite-toggle').forEach(t => t.classList.add('show-toggle'));
                document.querySelectorAll('.hide-toggle').forEach(t => t.classList.add('show-toggle'));
                document.querySelectorAll('.beta-label, .new-label, .one-p-label, .two-p-label, .live-label, .disabled-label, .plus-label').forEach(l => l.style.display = 'none');
            } else {
                btn.innerText = window.t('home.btn.edit', 'Edit');
                if (resetBtn) resetBtn.style.display = 'none';
                if (featToggle) featToggle.style.display = 'none';
                if (recentToggle) recentToggle.style.display = 'none';
                document.querySelectorAll('.favorite-toggle').forEach(t => t.classList.remove('show-toggle'));
                document.querySelectorAll('.hide-toggle').forEach(t => t.classList.remove('show-toggle'));
                document.querySelectorAll('.beta-label, .new-label, .one-p-label, .two-p-label, .live-label, .disabled-label, .plus-label').forEach(l => l.style.display = 'block');
            }
            if (currentFilter === 'all') renderFeaturedSection();
            renderAppGrid(currentFilter);
            renderFavoriteSection();
        }

        function updateRecentToggleLabel() {
            const btn = document.getElementById('recent-toggle-btn');
            if (!btn) return;
            const key = recentHidden ? 'home.btn.recent_off' : 'home.btn.recent_on';
            const def = recentHidden ? 'Recent: OFF' : 'Recent: ON';
            btn.innerText = window.t(key, def);
        }

        function toggleRecentSection() {
            recentHidden = !recentHidden;
            try { localStorage.setItem('rekindle_recent_hidden', recentHidden.toString()); } catch (e) { }
            updateRecentToggleLabel();
            if (currentFilter === 'all' && !appSearchQuery) {
                renderRecentSection();
                renderAppGrid('all');
            }
        }

        function toggleFeaturedSection() {
            featuredHidden = !featuredHidden;
            localStorage.setItem('rekindle_featured_hidden', featuredHidden.toString());
            const featToggle = document.getElementById('featured-toggle-btn');
            if (featToggle) {
                const key = featuredHidden ? 'home.btn.featured_off' : 'home.btn.featured_on';
                const def = featuredHidden ? 'Featured: OFF' : 'Featured: ON';
                featToggle.innerText = window.t ? window.t(key, def) : def;
            }
            if (currentFilter === 'all') renderFeaturedSection();
            renderAppGrid(currentFilter);
        }

        function openResetModal() {
            document.getElementById('reset-modal').style.display = 'flex';
        }

        function confirmReset() {
            favoriteApps = [];
            hiddenApps = [];
            featuredHidden = false;
            recentHidden = false;
            localStorage.setItem('rekindle_featured_hidden', 'false');
            localStorage.setItem('rekindle_recent_hidden', 'false');
            const featToggle = document.getElementById('featured-toggle-btn');
            if (featToggle) {
                const labelOn = window.t ? window.t('home.btn.featured_on', 'Featured: ON') : 'Featured: ON';
                featToggle.innerText = labelOn;
            }
            updateRecentToggleLabel();

            saveFavorites();
            if (currentFilter === 'all') renderFeaturedSection();
            renderFavoriteSection();
            renderAppGrid(currentFilter);
            closeModal('reset-modal');
        }

        function createAppElement(app) {
            const a = document.createElement('a');
            a.href = `${app.id}.html`;
            a.className = 'app-icon';
            a.id = `icon-${app.id}`;

            if (app.isFolder) {
                a.onclick = (e) => { e.preventDefault(); openFolderModal(app.name, app.groupedApps); };
                a.href = "javascript:void(0)";
            } else if (app.id === 'discord') {
                a.onclick = (e) => { e.preventDefault(); openDiscordModal(); };
                a.href = "javascript:void(0)";
            }

            if (app.disabled) {
                a.onclick = (e) => {
                    e.preventDefault();
                    showGenericModal(app.name + " Unavailable", app.disabledMessage || "This service is currently unavailable.");
                };
                a.href = "javascript:void(0)";
                a.classList.add('pro-locked');
            } else if (app.plus && !isPro) {
                // OPTIMIZATION: Removed 'gap:10px' from inline style (Flex Gap not supported in Chrome 75)
                // Locked tiles open a preview of the real app instead of a
                // modal: users see the value before they are asked to pay.
                a.onclick = (e) => {
                    e.preventDefault();
                    openLockedApp(app);
                };
                a.href = "javascript:void(0)";
                a.classList.add('pro-locked');
            }

            const isFav = favoriteApps.includes(app.id);
            const isHidden = hiddenApps.includes(app.id);
            const showToggleClass = isEditMode && currentFilter !== 'featured' ? 'show-toggle' : '';
            const isFavClass = isFav ? 'is-favorite' : '';
            const isHiddenClass = isHidden ? 'is-hidden' : '';

            // Recent list only records real launches; folders open a chooser and
            // Pro-locked tiles open the paywall, so neither counts as a launch.
            if (!app.isFolder && !app.disabled && !(app.plus && !isPro)) {
                a.addEventListener('click', function () { recordRecentApp(app.id); });
            }

            if (isHidden) { a.style.opacity = '0.4'; a.style.filter = 'grayscale(100%)'; }

            let extraHtml = `
                <div class="favorite-toggle ${isFavClass} ${showToggleClass}" onclick="toggleFavorite('${app.id}', event)">
                    <svg viewBox="0 0 32 32"><path d="M16 2 L20 12 L30 13 L22 20 L24 30 L16 25 L8 30 L10 20 L2 13 L12 12 Z"/></svg>
                </div>
                <div class="hide-toggle ${isHiddenClass} ${showToggleClass}" onclick="toggleHidden('${app.id}', event)">
                    <svg viewBox="0 0 32 32">
                         <path d="M2 16C2 16 8 6 16 6C24 6 30 16 30 16C30 16 24 26 16 26C8 26 2 16 2 16Z M16 10C12.6863 10 10 12.6863 10 16C10 19.3137 12.6863 22 16 22C19.3137 22 22 19.3137 22 16C22 12.6863 19.3137 10 16 10Z M16 13C17.6569 13 19 14.3431 19 16C19 17.6569 17.6569 19 16 19C14.3431 19 13 17.6569 13 16C13 14.3431 14.3431 13 16 13Z"/>
                         <line x1="2" y1="2" x2="30" y2="30" stroke="black" stroke-width="2" class="slash" style="${isHidden ? '' : 'display:none'}"/>
                    </svg>
                </div>`;

            const showPlus = app.plus && !isPro;
            if (!isEditMode) {
                if (app.live && !showPlus && !app.isFolder) extraHtml += `<div class="live-label">LIVE</div>`;
                else if (app.beta && !showPlus && !app.isFolder) extraHtml += `<div class="beta-label">BETA</div>`;
                else if (app.new && !showPlus && !app.isFolder) extraHtml += `<div class="new-label">NEW</div>`;
                else if (app.single && !showPlus && !app.isFolder) extraHtml += `<div class="one-p-label" data-i18n="badge.1p">1P</div>`;

                if (app.cat === 'two_player' && !showPlus && !app.isFolder) extraHtml += `<div class="two-p-label" data-i18n="badge.2p">2P</div>`;
                if (app.disabled) extraHtml += `<div class="disabled-label">CLOSED</div>`;
                else if (showPlus && !app.isFolder) {
                    // A lapsed member sees "REJOIN" instead of "PLUS": they
                    // already know what the app does, so the ask is quieter.
                    var wasPro = false;
                    try { wasPro = localStorage.getItem('rekindle_was_pro') === 'true'; } catch (e) { }
                    extraHtml += `<div class="plus-label">${wasPro ? 'REJOIN' : 'PLUS'}</div>`;
                }
            }

            const viewBox = app.viewBox || "0 0 32 32";
            const svgClass = app.filled ? 'icon-img' : 'icon-img outlined-icon';

            let iconHtml = `<span class="icon-img-wrap"><svg class="${svgClass}" viewBox="${viewBox}">${app.icon}</svg></span>`;

            let labelClass = "icon-label";
            if (app.isFolder) {
                labelClass += " folder-title-badge";
            }

            const labelId = app.i18nId || app.id;
            a.innerHTML = `${iconHtml}<span class="${labelClass}" data-i18n="app.${labelId}.name">${app.name}</span>${extraHtml}`;
            return a;
        }

        // ... [checkExitButtonVisibility, filterApps, renderFeaturedSection, renderAppGrid... unchanged except for Paywall modal fix applied above] ...

        function checkExitButtonVisibility() {
            const btn = document.getElementById('exit-btn');
            if (!btn) return;
            if (navigator.userAgent.indexOf(ALLOWED_EXIT_AGENT) === -1) btn.style.setProperty('display', 'none', 'important');
            else btn.style.setProperty('display', 'flex', 'important');
        }

        function persistHomeView(tab) {
            try {
                sessionStorage.setItem('rekindle_home_tab', tab || currentFilter || 'all');
                sessionStorage.setItem('rekindle_home_scroll_v1', JSON.stringify(homeScrollPositions));
            } catch (e) { /* sessionStorage unavailable */ }
        }

        function restoreHomeView() {
            let saved = '';
            try { saved = sessionStorage.getItem('rekindle_home_tab') || ''; } catch (e) { /* unavailable */ }
            const valid = ['all', 'dashboard', 'essentials', 'tools', 'lifestyle', 'games', 'two_player'];
            if (valid.indexOf(saved) === -1) saved = 'all';
            if (gamesDisabled && (saved === 'games' || saved === 'two_player')) saved = 'all';
            const btn = document.getElementById('nav-' + saved) || document.getElementById('nav-all');
            filterApps(saved, btn);
        }

        function filterApps(category, btnElement) {
            updateNavVisibility();
            if (appSearchOpen || appSearchQuery) resetAppSearchField();
            if (isEditMode) toggleEditMode();
            if (gamesDisabled && (category === 'games' || category === 'two_player')) { category = 'all'; btnElement = document.getElementById('nav-all'); }
            const appView = document.querySelector('.app-view');
            if (appView && currentFilter && currentFilter !== category) {
                homeScrollPositions[currentFilter] = appView.scrollTop;
            }
            currentFilter = category;
            document.querySelectorAll('.folder-tab').forEach(el => {
                el.classList.remove('active');
                el.setAttribute('aria-selected', 'false');
            });
            if (btnElement) {
                btnElement.classList.add('active');
                btnElement.setAttribute('aria-selected', 'true');
            }
            const editBtn = document.getElementById('edit-done-btn');
            if (category === 'all') {
                editBtn.style.display = 'inline-flex';
                editBtn.innerText = window.t(isEditMode ? 'home.btn.done' : 'home.btn.edit', isEditMode ? 'Done' : 'Edit');
            } else editBtn.style.display = 'none';

            if (category === 'all') renderForYouShelf();
            else hideForYouShelf();

            document.getElementById('dashboard-section').style.display = category === 'dashboard' ? 'flex' : 'none';
            if (category === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
            else if (typeof stopDashboardClock === 'function') stopDashboardClock();
            const mvh = document.getElementById('main-view-header');
            if (mvh) mvh.style.display = category === 'dashboard' ? 'none' : 'flex';
            document.getElementById('app-grid').style.display = category === 'dashboard' ? 'none' : 'grid';

            const searchRow = document.getElementById('app-search-row');
            if (searchRow) searchRow.style.display = 'none';

            const liveGamesSection = document.getElementById('live-games-section');
            if (liveGamesSection) {
                if (category === 'two_player') {
                    liveGamesSection.style.display = 'block';
                    // Detach badge listener — loadLiveGames has its own matchmaking listener
                    if (window._badgeDetach) window._badgeDetach();
                    ensureLiveGamesView();
                } else {
                    liveGamesSection.style.display = 'none';
                    if (window.liveGamesUnsubscribe) { window.liveGamesUnsubscribe(); window.liveGamesUnsubscribe = null; }
                    // Reattach badge listener now that Live Games tab is closed
                    if (window._badgeAttach) window._badgeAttach();
                }
            }

            renderAppGrid(category);
            persistHomeView(category);
            if (appView) {
                const targetScroll = category === 'dashboard' ? 0 : (homeScrollPositions[category] || 0);
                setTimeout(function () { appView.scrollTop = targetScroll; }, 0);
            }
        }

        function showLiveGamesSignIn() {
            const grid = document.getElementById('live-games-grid');
            if (!grid) return;
            const msg = window.t ? window.t('home.live_games.signin', 'Sign in to see live games.') : 'Sign in to see live games.';
            const login = window.t ? window.t('home.nav.login', 'LOG IN / REGISTER') : 'LOG IN / REGISTER';
            grid.innerHTML = '<div class="live-games-gate"><p>' + msg + '</p>' +
                '<button type="button" class="sys-btn" onclick="openLogin()">' + login + '</button></div>';
        }

        function ensureLiveGamesView() {
            const grid = document.getElementById('live-games-grid');
            if (grid) grid.innerHTML = '<div class="live-games-gate"><p>Loading live games...</p></div>';
            if (!hasStoredSession() && !window._rekindleAuthedUid) {
                showLiveGamesSignIn();
                return;
            }
            bootFirebaseAuth().then(function () {
                if (!window._rekindleAuthedUid) {
                    showLiveGamesSignIn();
                    return null;
                }
                return ensureRtdb().then(function () {
                    loadLiveGames();
                });
            }).catch(function () {
                showLiveGamesSignIn();
            });
        }

        function loadLiveGames() {
            if (!isFirebaseAvailable || !rtdb) { showLiveGamesSignIn(); return; }
            const grid = document.getElementById('live-games-grid');
            if (window.liveGamesUnsubscribe) window.liveGamesUnsubscribe();

            grid.innerHTML = '<div style="grid-column: 1 / -1; font-size: 0.9rem; font-style: italic;">Loading live games...</div>';

            const ref = rtdb.ref('matchmaking');
            let currentRenderId = 0;
            const listener = ref.on('value', async snap => {
                const renderId = ++currentRenderId;
                let waitingMatches = [];
                
                if (snap.exists()) {
                    const games = snap.val();
                    for (const gameType in games) {
                        for (const matchId in games[gameType]) {
                            const match = games[gameType][matchId];
                            if (match.status === 'waiting') {
                                waitingMatches.push({ gameType, matchId, match });
                            }
                        }
                    }
                }

                const validatedMatches = await Promise.all(waitingMatches.map(async item => {
                    const result = await validateLiveMatch(item.gameType, item.matchId, item.match);
                    item.isOnline = result.valid;
                    if (result.hostUid) item.match.hostUid = result.hostUid;
                    if (result.hostName) item.match.hostName = result.hostName;
                    return item;
                }));

                if (renderId !== currentRenderId) return;

                // Keep badge in sync while on the live games tab (badge listener is detached here)
                const onlineCount = validatedMatches.filter(i => i.isOnline).length;
                const badge = document.getElementById('live-games-count');
                if (badge) {
                    badge.innerText = onlineCount;
                    badge.style.display = onlineCount > 0 ? 'inline-flex' : 'none';
                }

                grid.innerHTML = '';
                let hasGames = false;

                const lobbiesContainer = document.createElement('div');
                lobbiesContainer.className = 'lobby-grid';
                lobbiesContainer.style.marginBottom = '15px';

                for (const item of validatedMatches) {
                    if (!item.isOnline) continue;
                    
                    hasGames = true;
                    const { gameType, matchId, match } = item;
                    const gameId = 'live' + gameType;
                    const gameDef = APPS.find(a => a.id === gameId) || APPS.find(a => a.id === gameType) || { name: gameType, icon: '<circle cx="16" cy="16" r="10" fill="none" stroke="black" stroke-width="2"/>', viewBox: "0 0 32 32", filled: false, id: gameType };

                    const card = document.createElement('a');
                    card.className = 'lobby-card';
                    card.href = `${gameDef.id}.html?matchId=${matchId}`;

                    const hostName = match.hostName || 'Someone';
                    const svgClass = gameDef.filled ? 'lobby-game-icon' : 'lobby-game-icon outlined-icon';
                    const gameIconHtml = `<svg class="${svgClass}" viewBox="${gameDef.viewBox || '0 0 32 32'}">${gameDef.icon}</svg>`;

                    card.innerHTML = `
                        ${gameIconHtml}
                        <canvas class="lobby-avatar" width="64" height="64" style="width:40px; height:40px;"></canvas>
                        <div class="lobby-info">
                            <div class="lobby-username">${hostName}</div>
                            <div class="lobby-game-name">${gameDef.name}</div>
                        </div>
                    `;

                    lobbiesContainer.appendChild(card);

                    // Draw avatar after appending
                    setTimeout(() => {
                        const canvas = card.querySelector('canvas');
                        const fallbackSeed = match.hostUid || hostName;
                        if (canvas) {
                            window.rekindleFetchAvatarSeed(rtdb, match.hostUid, seed => {
                                drawAvatar(canvas, seed || fallbackSeed);
                            });
                        }
                    }, 0);
                }

                if (hasGames) {
                    grid.appendChild(lobbiesContainer);
                }

                // Regular launchers grid
                const launchersGrid = document.createElement('div');
                launchersGrid.className = 'grid-container';
                launchersGrid.style.width = '100%';

                const liveApps = APPS.filter(a => a.live).sort((a, b) => a.name.localeCompare(b.name));
                liveApps.forEach(gameDef => {
                    const iconEl = createAppElement(gameDef);
                    launchersGrid.appendChild(iconEl);
                    hasGames = true;
                });

                grid.appendChild(launchersGrid);

                if (!hasGames) {
                    grid.innerHTML = '<div style="grid-column: 1 / -1; font-size: 0.9rem; font-style: italic;">No live games available.</div>';
                }
            }, err => {
                grid.innerHTML = '<div style="grid-column: 1 / -1; font-size: 0.9rem; font-style: italic;">Error loading live games.</div>';
                console.error(err);
            });

            window.liveGamesUnsubscribe = () => ref.off('value', listener);
        }

        let preferredHomeShelf = 'featured';
        try {
            preferredHomeShelf = localStorage.getItem('rekindle_home_shelf') ||
                sessionStorage.getItem('rekindle_home_shelf') || 'featured';
        } catch (e) { preferredHomeShelf = 'featured'; }
        if (['featured', 'recent', 'favorites'].indexOf(preferredHomeShelf) === -1) {
            preferredHomeShelf = 'featured';
        }
        let currentHomeShelf = preferredHomeShelf;
        let homeShelfFallback = false;
        try { localStorage.setItem('rekindle_home_shelf', preferredHomeShelf); } catch (e) { /* unavailable */ }

        function createShelfCard(app) {
            const a = document.createElement('a');
            a.href = `${app.id}.html`;
            if (app.id === 'discord') { a.onclick = (e) => { e.preventDefault(); openDiscordModal(); }; a.href = 'javascript:void(0)'; }
            a.className = 'featured-card';
            let badgeHtml = '';
            if (!isEditMode) {
                if (app.plus && !isPro) badgeHtml = '<div class="plus-label" style="right:15px; top:5px;">PLUS</div>';
                else if (app.cat === 'two_player') badgeHtml = '<div class="two-p-label" data-i18n="badge.2p">2P</div>';
            }
            if (app.plus && !isPro) {
                a.onclick = (e) => { e.preventDefault(); openLockedApp(app); };
                a.href = 'javascript:void(0)';
                a.classList.add('pro-locked');
            }
            a.innerHTML = `<div class="featured-icon"><svg viewBox="0 0 32 32" style="width:100%;height:100%;">${app.icon}</svg></div><div class="featured-info"><span class="featured-title" data-i18n="app.${app.id}.name">${app.name}</span><span class="featured-sub" data-i18n="app.${app.id}.desc">${app.desc || ''}</span></div>${badgeHtml}`;
            if (!app.disabled && !(app.plus && !isPro)) {
                a.addEventListener('click', function () { recordRecentApp(app.id); });
            }
            return a;
        }

        function shelfData() {
            const recent = (recentHidden || isEditMode) ? [] : getVisibleRecentApps();
            let favorites = favoriteApps.map(function (id) { return APPS.find(function (app) { return app.id === id; }); })
                .filter(function (app) { return app && hiddenApps.indexOf(app.id) === -1; });
            if (gamesDisabled) favorites = favorites.filter(function (app) { return app.cat !== 'games' && app.cat !== 'two_player' && app.cat !== 'live_game'; });
            let featured = [];
            if (!featuredHidden) {
                featured = APPS.filter(function (app) { return app.featured; });
                if (gamesDisabled) featured = featured.filter(function (app) { return app.cat !== 'games' && app.cat !== 'two_player'; });
                featured.sort(function (a, b) { return (a.featuredOrder || 999) - (b.featuredOrder || 999); });
            }
            return { recent: recent, favorites: favorites, featured: featured };
        }

        function hideForYouShelf() {
            const section = document.getElementById('foryou-section');
            if (section) section.style.display = 'none';
        }

        function selectHomeShelf(shelf) {
            if (['featured', 'recent', 'favorites'].indexOf(shelf) === -1) return;
            currentHomeShelf = shelf;
            preferredHomeShelf = shelf;
            homeShelfFallback = false;
            try {
                localStorage.setItem('rekindle_home_shelf', shelf);
                sessionStorage.setItem('rekindle_home_shelf', shelf);
            } catch (e) { /* unavailable */ }
            renderForYouShelf();
        }

        function renderForYouShelf() {
            const section = document.getElementById('foryou-section');
            const grid = document.getElementById('foryou-grid');
            if (!section || !grid) return;
            if (appSearchQuery || currentFilter !== 'all') { hideForYouShelf(); return; }

            const data = shelfData();
            const order = ['featured', 'recent', 'favorites'];
            const counts = { featured: data.featured.length, recent: data.recent.length, favorites: data.favorites.length };
            const available = order.filter(function (key) { return counts[key] > 0; });
            if (!available.length) { hideForYouShelf(); return; }

            // A saved shelf can be temporarily unavailable while auth/Firestore
            // data is still loading; remember that we fell back so it can be
            // restored as soon as its data arrives.
            if (homeShelfFallback && available.indexOf(preferredHomeShelf) !== -1) {
                currentHomeShelf = preferredHomeShelf;
                homeShelfFallback = false;
            }
            if (!currentHomeShelf || available.indexOf(currentHomeShelf) === -1) {
                currentHomeShelf = available[0];
                homeShelfFallback = true;
            }

            const tabs = section.querySelectorAll('.foryou-tab');
            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const key = tab.getAttribute('data-shelf');
                const isAvailable = counts[key] > 0;
                tab.style.display = isAvailable ? 'inline-flex' : 'none';
                const active = key === currentHomeShelf;
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
                // Keep every available tab in the Tab order: there is no
                // arrow-key roving-tabindex handler yet, so tabindex="-1"
                // would make the other shelves unreachable by keyboard.
                tab.setAttribute('tabindex', '0');
            }

            grid.innerHTML = '';
            const fragment = document.createDocumentFragment();
            if (currentHomeShelf === 'featured') {
                grid.className = 'grid-container foryou-cards';
                data.featured.forEach(function (app) { fragment.appendChild(createShelfCard(app)); });
            } else {
                grid.className = 'grid-container';
                const list = currentHomeShelf === 'recent' ? data.recent : data.favorites;
                list.forEach(function (app) {
                    const el = createAppElement(app);
                    // The same app may now also be in All Applications; keep
                    // DOM ids unique across the two surfaces.
                    el.id = 'shelf-icon-' + app.id;
                    fragment.appendChild(el);
                });
            }
            grid.appendChild(fragment);

            const clearBtn = document.getElementById('foryou-clear');
            if (clearBtn) clearBtn.style.display = currentHomeShelf === 'recent' ? 'inline-flex' : 'none';
            section.style.display = 'block';
            if (isEditMode) {
                section.querySelectorAll('.favorite-toggle').forEach(function (t) { t.classList.add('show-toggle'); });
                section.querySelectorAll('.hide-toggle').forEach(function (t) { t.classList.add('show-toggle'); });
            }
        }

        function renderFeaturedSection() {
            renderForYouShelf();
        }

        function getGroupedApps(appList) {
            const gameCats = ['games', 'two_player', 'live_game'];
            const groups = {};
            const result = [];

            appList.forEach(app => {
                if (gameCats.includes(app.cat)) {
                    if (!groups[app.name]) { groups[app.name] = []; }
                    groups[app.name].push(app);
                } else {
                    result.push(app);
                }
            });

            for (const name in groups) {
                const group = groups[name];
                if (group.length > 1) {
                    group.sort((a, b) => {
                        const orderA = a.live ? 3 : (a.cat === 'two_player' ? 2 : 1);
                        const orderB = b.live ? 3 : (b.cat === 'two_player' ? 2 : 1);
                        return orderA - orderB;
                    });
                    const primaryApp = group.find(a => !a.live && !a.cat.includes('two_player')) || group[0];
                    const folderApp = Object.assign({}, primaryApp);
                    folderApp.id = 'folder_' + primaryApp.id;
                    folderApp.i18nId = primaryApp.id;
                    folderApp.isFolder = true;
                    folderApp.groupedApps = group;
                    result.push(folderApp);
                } else {
                    result.push(group[0]);
                }
            }
            return result;
        }

        function appsForCategory(category) {
            if (category === 'all') return APPS.slice();
            if (category === 'two_player') {
                return APPS.filter(a => a.cat === 'two_player' || a.cat === 'live_game');
            }
            return APPS.filter(a => Array.isArray(a.cat) ? a.cat.includes(category) : a.cat === category);
        }

        function appMatchesSearch(app, terms) {
            const translations = window.rekindleTranslations || {};
            const localizedName = translations['app.' + app.id + '.name'] || '';
            const localizedDesc = translations['app.' + app.id + '.desc'] || '';
            const haystack = ((app.name || '') + ' ' + (app.desc || '') + ' ' + app.id + ' ' +
                localizedName + ' ' + localizedDesc).toLowerCase();
            for (let i = 0; i < terms.length; i++) {
                if (haystack.indexOf(terms[i]) === -1) return false;
            }
            return true;
        }

        function setAppSearchActive(active) {
            const btn = document.getElementById('app-search-toggle');
            if (!btn) return;
            if (active) btn.classList.add('is-active');
            else btn.classList.remove('is-active');
            btn.setAttribute('aria-expanded', active ? 'true' : 'false');
        }

        function resetAppSearchField() {
            appSearchQuery = '';
            appSearchOpen = false;
            if (appSearchTimer) { clearTimeout(appSearchTimer); appSearchTimer = null; }
            const input = document.getElementById('app-search');
            const clearBtn = document.getElementById('app-search-clear');
            const row = document.getElementById('app-search-row');
            if (input) input.value = '';
            if (clearBtn) clearBtn.style.display = 'none';
            if (row) row.style.display = 'none';
            setAppSearchActive(false);
        }

        function openAppSearch() {
            if (currentFilter === 'dashboard') return;
            if (isEditMode) toggleEditMode();
            appSearchOpen = true;
            const row = document.getElementById('app-search-row');
            if (row) row.style.display = 'flex';
            setAppSearchActive(true);
            const input = document.getElementById('app-search');
            if (input) {
                input.focus();
                try { input.scrollIntoView({ block: 'nearest' }); } catch (e) { }
            }
        }

        function closeAppSearch() {
            const wasOpen = appSearchOpen || !!appSearchQuery;
            resetAppSearchField();
            if (wasOpen) filterApps(currentFilter, document.querySelector('.folder-tab.active'));
        }

        function runHomeSearch(query) {
            const q = String(query || '').trim();
            if (!q) return;
            if (currentFilter !== 'all') filterApps('all', document.querySelector('#nav-all'));
            appSearchOpen = true;
            appSearchQuery = q.toLowerCase();
            const row = document.getElementById('app-search-row');
            if (row) row.style.display = 'flex';
            const input = document.getElementById('app-search');
            if (input) input.value = q;
            setAppSearchActive(true);
            renderAppGrid('all');
        }

        function toggleAppSearch() {
            if (appSearchOpen || appSearchQuery) closeAppSearch();
            else openAppSearch();
        }

        // 220ms debounce: each rebuild creates up to ~125 icon nodes, so filtering
        // on every keystroke is visibly slow on a jitless Kindle.
        function onAppSearchInput() {
            const input = document.getElementById('app-search');
            const clearBtn = document.getElementById('app-search-clear');
            if (!input) return;
            if (clearBtn) clearBtn.style.display = input.value ? 'block' : 'none';
            if (appSearchTimer) clearTimeout(appSearchTimer);
            appSearchTimer = setTimeout(function () {
                appSearchTimer = null;
                const query = input.value.trim();
                if (!query) {
                    closeAppSearch();
                    return;
                }
                if (currentFilter === 'dashboard') return;
                appSearchQuery = query;
                appSearchOpen = true;
                renderAppGrid(currentFilter);
            }, 220);
        }

        // Only JS-written labels need a refresh here; the i18n loader has
        // already translated every data-i18n node in the document, so a full
        // grid rebuild on a slow Kindle would be wasted work.
        document.addEventListener('rekindle:i18n:ready', function () {
            const navAllReady = document.getElementById('nav-all');
            const navDashReady = document.getElementById('nav-dashboard');
            if (navAllReady) navAllReady.setAttribute('aria-label', window.t('home.nav.all_apps', 'All Apps'));
            if (navDashReady) navDashReady.setAttribute('aria-label', window.t('home.nav.dashboard', 'Dashboard'));
            if (appSearchQuery) { renderAppGrid(currentFilter); return; }
            if (currentFilter === 'dashboard') return;
            const title = document.getElementById('category-title');
            if (title) title.innerText = categoryTitleFor(currentFilter);
            const editBtn = document.getElementById('edit-done-btn');
            if (editBtn) {
                editBtn.innerText = window.t(isEditMode ? 'home.btn.done' : 'home.btn.edit', isEditMode ? 'Done' : 'Edit');
            }
            if (document.getElementById('recent-toggle-btn')) updateRecentToggleLabel();
            const gamesHeader = document.getElementById('all-games-header');
            if (gamesHeader) gamesHeader.innerText = window.t('home.header.all_games', 'All Games');
        });

        function getVisibleRecentApps() {
            return recentApps.map(function (id) {
                return APPS.find(function (app) { return app.id === id; });
            }).filter(function (app) {
                return app && (!app.featured || featuredHidden) && hiddenApps.indexOf(app.id) === -1;
            });
        }

        function recordRecentApp(id) {
            const app = APPS.find(function (candidate) { return candidate.id === id; });
            if (!app || (app.featured && !featuredHidden) || app.isFolder || app.disabled) return;
            if (!id || recentApps[0] === id) return;
            recentApps = [id].concat(recentApps.filter(function (savedId) { return savedId !== id; })).slice(0, 6);
            try { localStorage.setItem('rekindle_recent_apps', JSON.stringify(recentApps)); } catch (e) { }
            renderRecentSection();
        }

        // Warm the most-used app while the dashboard is idle: one fetch that the
        // service worker caches, so the next tap on that tile is instant instead
        // of waiting for a network round trip on a slow e-ink connection.
        function warmRecentApp() {
            if (document.hidden || !navigator.onLine || !recentApps.length) return;
            try {
                if (navigator.connection && navigator.connection.saveData) return;
            } catch (e) { /* older browsers */ }
            const id = recentApps[0];
            if (!id || id === 'discord') return;
            const run = function () {
                fetch(id + '.html', { credentials: 'same-origin' }).catch(function () { });
            };
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(run, { timeout: 4000 });
            } else {
                setTimeout(run, 2500);
            }
        }

        function clearRecentApps() {
            recentApps = [];
            try { localStorage.removeItem('rekindle_recent_apps'); } catch (e) { }
            renderRecentSection();
            // Clearing recents returns the apps to the All Applications grid.
            if (currentFilter === 'all' && !isEditMode && !appSearchQuery) renderAppGrid('all');
        }

        // --- ReKindle+ nudge (one ribbon, remembered per account) ----------
        var PLUS_NUDGE_VERSION = 'v1';

        function plusNudgeKey() {
            var uid = 'anon';
            try { uid = localStorage.getItem('rekindle_uid') || 'anon'; } catch (e) { }
            return 'rekindle_plus_nudge_' + PLUS_NUDGE_VERSION + '_' + uid;
        }

        function plusNudgeDismissed() {
            try { return localStorage.getItem(plusNudgeKey()) === 'true'; } catch (e) { return false; }
        }

        function dismissPlusNudge() {
            try { localStorage.setItem(plusNudgeKey(), 'true'); } catch (e) { }
            hidePlusNudge();
        }

        function hidePlusNudge() {
            var el = document.getElementById('plus-nudge');
            if (el) el.style.display = 'none';
        }

        // A different Plus app each week, so the ribbon stays a product
        // introduction rather than a static ad.
        function plusPickForWeek() {
            var picks = APPS.filter(function (app) { return app.plus && !app.disabled; });
            if (!picks.length) return null;
            var week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
            return picks[week % picks.length];
        }

        function renderPlusNudge() {
            var el = document.getElementById('plus-nudge');
            if (!el) return;
            var show = !isPro && !plusNudgeDismissed() && !isEditMode && !appSearchQuery && currentFilter === 'all';
            if (!show) { el.style.display = 'none'; return; }
            var pick = plusPickForWeek();
            var weekEl = document.getElementById('plus-nudge-week');
            if (weekEl) {
                if (pick) {
                    weekEl.style.display = '';
                    weekEl.innerText = window.tFormat
                        ? window.tFormat('plus.nudge.week', { app: pick.name }, 'This week: ${app}')
                        : ('This week: ' + pick.name);
                    // The weekly pick opens its preview, so the line is a product
                    // introduction rather than a static ad.
                    weekEl.href = 'preview.html?app=' + encodeURIComponent(pick.id);
                } else {
                    weekEl.style.display = 'none';
                }
            }
            el.style.display = 'flex';
        }

        function renderRecentSection() {
            renderForYouShelf();
        }

        function homeSearchActions(terms) {
            const t = function (key, fallback) { return window.t ? window.t(key, fallback) : fallback; };
            const list = [
                {
                    key: 'dashboard widgets weather calendar time',
                    name: t('home.nav.dashboard', 'Dashboard'),
                    desc: t('dashboard.localtime', 'Local Time') + ' · ' + t('app.weather.name', 'Weather'),
                    run: function () { filterApps('dashboard', document.getElementById('nav-dashboard')); }
                },
                {
                    key: 'settings preferences location theme account',
                    name: t('home.nav.settings', 'Settings'),
                    desc: '',
                    href: 'settings.html'
                },
                {
                    key: 'help faq support guide',
                    name: t('home.nav.help', 'Help'),
                    desc: '',
                    href: 'help.html'
                },
                {
                    key: 'plus membership subscription pro',
                    name: t('plus.nudge.title', 'ReKindle+'),
                    desc: t('plus.nudge.text', 'Mail, files and 11 more.'),
                    href: 'membership.html'
                },
                {
                    key: 'login register sign account',
                    name: t('home.nav.login', 'Log In / Register'),
                    desc: '',
                    run: function () { openLogin(); }
                },
                {
                    key: 'all apps applications home',
                    name: t('home.nav.all_apps', 'All Apps'),
                    desc: '',
                    run: function () { filterApps('all', document.getElementById('nav-all')); }
                }
            ];
            return list.filter(function (action) {
                const haystack = (action.name + ' ' + action.desc + ' ' + action.key).toLowerCase();
                for (let i = 0; i < terms.length; i++) {
                    if (haystack.indexOf(terms[i]) === -1) return false;
                }
                return true;
            });
        }

        function highlightSearchLabel(el, app, terms) {
            const label = el.querySelector('.icon-label');
            if (!label) return;
            const i18nId = app.i18nId || app.id;
            const text = window.t ? window.t('app.' + i18nId + '.name', app.name) : app.name;
            label.removeAttribute('data-i18n');
            // Folder labels are already an inverted pill; a black <mark> inside
            // one is invisible, so leave the pill's own styling alone.
            if (label.classList.contains('folder-title-badge')) {
                label.textContent = text;
                return;
            }
            label.textContent = '';

            const lower = text.toLowerCase();
            const ranges = [];
            terms.forEach(function (term) {
                let idx = lower.indexOf(term);
                while (idx !== -1) {
                    ranges.push([idx, idx + term.length]);
                    idx = lower.indexOf(term, idx + term.length);
                }
            });
            if (!ranges.length) {
                label.textContent = text;
                return;
            }
            ranges.sort(function (a, b) { return a[0] - b[0]; });
            const fragment = document.createDocumentFragment();
            let pos = 0;
            ranges.forEach(function (range) {
                if (range[0] < pos) return;
                if (range[0] > pos) fragment.appendChild(document.createTextNode(text.slice(pos, range[0])));
                const mark = document.createElement('mark');
                mark.textContent = text.slice(range[0], range[1]);
                fragment.appendChild(mark);
                pos = range[1];
            });
            if (pos < text.length) fragment.appendChild(document.createTextNode(text.slice(pos)));
            label.appendChild(fragment);
        }

        function renderSearchActions(actions) {
            const wrap = document.getElementById('search-actions');
            if (!wrap) return;
            wrap.innerHTML = '';
            if (!actions.length) {
                wrap.style.display = 'none';
                return;
            }
            const title = document.createElement('div');
            title.className = 'search-actions-title';
            title.textContent = window.t ? window.t('home.search.actions', 'Actions') : 'Actions';
            wrap.appendChild(title);

            actions.forEach(function (action) {
                const el = document.createElement(action.href ? 'a' : 'button');
                el.className = 'search-action';
                if (action.href) {
                    el.href = action.href;
                } else {
                    el.type = 'button';
                    el.addEventListener('click', function () {
                        closeAppSearch();
                        action.run();
                    });
                }
                const name = document.createElement('span');
                name.className = 'search-action-name';
                name.textContent = action.name;
                el.appendChild(name);
                if (action.desc) {
                    const desc = document.createElement('span');
                    desc.className = 'search-action-desc';
                    desc.textContent = action.desc;
                    el.appendChild(desc);
                }
                const arrow = document.createElement('span');
                arrow.className = 'search-action-arrow';
                arrow.textContent = '>';
                el.appendChild(arrow);
                wrap.appendChild(el);
            });
            wrap.style.display = 'block';
        }

        function renderSearchResults(category) {
            const grid = document.getElementById('app-grid');
            const terms = appSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);
            if (!terms.length) return;

            let pool = appsForCategory(category);
            if (!isEditMode) pool = pool.filter(function (app) { return hiddenApps.indexOf(app.id) === -1; });
            if (gamesDisabled) pool = pool.filter(function (app) {
                return app.cat !== 'games' && app.cat !== 'two_player' && app.cat !== 'live_game';
            });

            const matched = pool.filter(function (app) { return appMatchesSearch(app, terms); });
            const gameCats = ['games', 'two_player', 'live_game'];
            const games = matched.filter(function (app) { return gameCats.indexOf(app.cat) !== -1; });
            const others = matched.filter(function (app) { return gameCats.indexOf(app.cat) === -1; });
            const items = others.concat(getGroupedApps(games));
            const actions = homeSearchActions(terms);
            const query = appSearchQuery.toLowerCase();

            // Exact and prefix matches first, then alphabetical.
            items.sort(function (a, b) {
                function rank(app) {
                    const name = (app.name || '').toLowerCase();
                    if (name === query) return 0;
                    if (name.indexOf(query) === 0) return 1;
                    return 2;
                }
                const diff = rank(a) - rank(b);
                return diff || a.name.localeCompare(b.name);
            });

            ['foryou-section', 'live-games-section'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            document.getElementById('category-title').innerText =
                window.t('home.search.results', 'Search results') + ' (' + (items.length + actions.length) + ')';
            const searchEditBtn = document.getElementById('edit-done-btn');
            if (searchEditBtn) searchEditBtn.style.display = 'none';

            if (!items.length && !actions.length) {
                grid.style.display = 'grid';
                grid.style.gridAutoRows = 'auto';
                const emptyText = window.t('home.search.empty', 'No apps match your search.');
                if (window.rekindleEmptyState) {
                    grid.innerHTML = window.rekindleEmptyState(emptyText, {
                        icon: 'search',
                        hint: window.t('home.search.hint', 'Try another word, or clear the search.'),
                        action: '<button class="rk-empty-btn" type="button" onclick="closeAppSearch()">' +
                            window.t('home.search.clear', 'Clear search') + '</button>',
                        className: 'rk-empty-grid'
                    });
                } else {
                    grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 24px; text-align: center; font-weight: bold;">' + emptyText + '</div>';
                }
                renderSearchActions([]);
                return;
            }

            grid.innerHTML = '';
            grid.style.gridAutoRows = '';
            if (!items.length) {
                grid.style.display = 'none';
            } else {
                grid.style.display = 'grid';
                const fragment = document.createDocumentFragment();
                items.slice(0, 60).forEach(function (app) {
                    const el = createAppElement(app);
                    highlightSearchLabel(el, app, terms);
                    fragment.appendChild(el);
                });
                grid.appendChild(fragment);
            }
            renderSearchActions(actions);
        }

        function categoryTitleFor(category) {
            const titleKeys = {
                essentials: 'home.nav.essentials',
                tools: 'home.nav.tools',
                lifestyle: 'home.nav.lifestyle',
                games: 'home.nav.games',
                two_player: 'home.nav.two_player'
            };
            const titleDefaults = {
                essentials: 'Essentials',
                tools: 'Tools',
                lifestyle: 'Lifestyle',
                games: 'Games',
                two_player: 'Multiplayer Games'
            };
            if (category === 'all') return window.t('home.header.all', 'All Applications');
            return window.t(titleKeys[category] || '', titleDefaults[category] || 'Applications');
        }

        function buildAppGrid(category) {
            const grid = document.getElementById('app-grid');
            grid.innerHTML = '';
            grid.style.gridAutoRows = '';
            grid.style.display = '';
            const searchActions = document.getElementById('search-actions');
            if (searchActions) {
                searchActions.style.display = 'none';
                searchActions.innerHTML = '';
            }

            if (appSearchQuery && category !== 'dashboard') {
                renderSearchResults(category);
                hidePlusNudge();
                return;
            }

            let appsToRender = APPS;
            if (category !== 'all') {
                appsToRender = APPS.filter(a => Array.isArray(a.cat) ? a.cat.includes(category) : a.cat === category);
                if (category === 'two_player') {
                    // Include both two_player and live_game in the Multiplayer tab, 
                    // but exclude live games from the generic bottom list since they are in the top Live section
                    appsToRender = APPS.filter(a => a.cat === 'two_player' || a.cat === 'live_game');
                    appsToRender = appsToRender.filter(a => !a.live);
                }
            }

            const fragment = document.createDocumentFragment();

            if (category === 'all' || currentFilter === 'all') {
                document.getElementById('category-title').innerText = categoryTitleFor('all');
                // Favorites and recent apps also belong in All Applications.
                // A featured favorite is included here even while the Featured
                // shelf is showing, otherwise it would still be absent from All.
                let baseList = APPS.filter(a =>
                    !a.featured || featuredHidden || favoriteApps.includes(a.id)
                );
                if (!isEditMode) baseList = baseList.filter(a => !hiddenApps.includes(a.id));
                if (gamesDisabled) baseList = baseList.filter(app => app.cat !== 'games' && app.cat !== 'two_player' && app.cat !== 'live_game');
                let games = baseList.filter(a => (a.cat === 'games' || a.cat === 'two_player' || a.cat === 'live_game'));
                const apps = baseList.filter(a => a.cat !== 'games' && a.cat !== 'two_player' && a.cat !== 'live_game');

                apps.sort((a, b) => a.name.localeCompare(b.name));
                games = getGroupedApps(games);
                games.sort((a, b) => a.name.localeCompare(b.name));

                apps.forEach(app => fragment.appendChild(createAppElement(app)));

                if (games.length > 0) {
                    const header = document.createElement('div');
                    header.className = 'view-header';
                    header.style.gridColumn = '1 / -1'; header.style.marginTop = '25px'; header.style.marginBottom = '15px'; header.style.borderBottom = '2px solid black';
                    header.innerHTML = '<span id="all-games-header" style="font-size: 1.2rem; font-weight: bold;">' + window.t('home.header.all_games', 'All Games') + '</span>';
                    fragment.appendChild(header);
                    games.forEach(app => fragment.appendChild(createAppElement(app)));
                }
            } else {
                let filtered = appsToRender;
                if (!isEditMode) filtered = filtered.filter(a => !hiddenApps.includes(a.id));
                if (gamesDisabled) filtered = filtered.filter(app => app.cat !== 'games' && app.cat !== 'two_player' && app.cat !== 'live_game');

                if (category === 'games' || category === 'two_player') {
                    filtered = getGroupedApps(filtered);
                }

                filtered.sort((a, b) => a.name.localeCompare(b.name));
                document.getElementById('category-title').innerText = categoryTitleFor(currentFilter);
                filtered.forEach(app => fragment.appendChild(createAppElement(app)));
            }
            grid.appendChild(fragment);
        }

        function finalizeAppGrid(category) {
            const titleEl = document.getElementById('category-title');
            if (titleEl) {
                titleEl.innerText = category === 'all' ? categoryTitleFor('all') : categoryTitleFor(currentFilter);
            }
            if (isEditMode) {
                document.getElementById('app-grid').querySelectorAll('.favorite-toggle').forEach(t => t.classList.add('show-toggle'));
                document.getElementById('app-grid').querySelectorAll('.hide-toggle').forEach(t => t.classList.add('show-toggle'));
                document.getElementById('app-grid').querySelectorAll('.beta-label, .new-label, .one-p-label, .two-p-label, .folder-label, .live-label, .disabled-label, .plus-label').forEach(l => l.style.display = 'none');
            }
            if (category === 'all' && !isEditMode) renderForYouShelf();
            else hideForYouShelf();
            renderPlusNudge();
        }

        const appGridCache = new Map();
        const APP_GRID_CACHE_MAX = 4;

        function appGridCacheKey(category) {
            let recentIds = '';
            if (category === 'all' && !recentHidden && !isEditMode) {
                recentIds = getVisibleRecentApps().map(function (app) { return app.id; }).join(',');
            }
            return [
                category,
                currentFilter,
                isEditMode ? 'e1' : 'e0',
                isPro ? 'p1' : 'p0',
                gamesDisabled ? 'g1' : 'g0',
                featuredHidden ? 'f1' : 'f0',
                recentHidden ? 'r1' : 'r0',
                favoriteApps.join(','),
                hiddenApps.join(','),
                recentIds,
                new Date().toDateString()
            ].join('|');
        }

        function renderAppGrid(category) {
            const grid = document.getElementById('app-grid');
            if (appSearchQuery && category !== 'dashboard') {
                buildAppGrid(category);
                return;
            }
            if (category === 'dashboard') {
                buildAppGrid(category);
                return;
            }

            const key = appGridCacheKey(category);
            const cached = appGridCache.get(key);
            if (cached) {
                grid.innerHTML = '';
                grid.style.gridAutoRows = '';
                grid.style.display = '';
                const searchActions = document.getElementById('search-actions');
                if (searchActions) {
                    searchActions.style.display = 'none';
                    searchActions.innerHTML = '';
                }
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < cached.length; i++) fragment.appendChild(cached[i]);
                grid.appendChild(fragment);
                finalizeAppGrid(category);
                return;
            }

            buildAppGrid(category);
            const nodes = Array.prototype.slice.call(grid.children);
            if (nodes.length) {
                if (appGridCache.size >= APP_GRID_CACHE_MAX) {
                    appGridCache.delete(appGridCache.keys().next().value);
                }
                appGridCache.set(key, nodes);
            }
            finalizeAppGrid(category);
        }

        // ... [Remaining helper functions openLogin, openAbout, etc. unchanged] ...
        // A page can send users here with ?login=true&return=<relative target>
        // (pay.html does this) so the plan/tile they picked survives sign-in.
        // Only same-site relative paths are accepted, never //host or a scheme.
        function loginReturnTarget() {
            try {
                var raw = new URLSearchParams(window.location.search).get('return');
                if (!raw) return '';
                var target = decodeURIComponent(raw);
                if (!/^[a-z0-9_.-]+(\.html)?(\?[a-z0-9_.=&%-]+)?$/i.test(target)) return '';
                return target;
            } catch (e) { return ''; }
        }
        function finishLoginRedirect() {
            var target = loginReturnTarget();
            if (!target) return false;
            window.location.href = target;
            return true;
        }
        function openLogin() {
            document.getElementById('login-modal').style.display = 'flex';
            // User intent: start the auth SDK while they type their password.
            bootFirebaseAuth();
        }
        function openAbout() { document.getElementById('about-modal').style.display = 'flex'; }

        function openFolderModal(appName, groupedAppsArray) {
            const titleApp = groupedAppsArray && groupedAppsArray.length ? groupedAppsArray[0] : null;
            const titleKey = titleApp ? ('app.' + titleApp.id + '.name') : '';
            document.getElementById('folder-title').innerText = titleKey ? window.t(titleKey, appName) : appName;
            const container = document.getElementById('folder-options');
            container.innerHTML = '';

            const fragment = document.createDocumentFragment();
            groupedAppsArray.forEach(app => {
                const clonedApp = Object.assign({}, app);
                const element = createAppElement(clonedApp);
                element.id = 'modal-icon-' + clonedApp.id;

                element.querySelectorAll('.favorite-toggle, .hide-toggle, .plus-label').forEach(e => e.remove());

                fragment.appendChild(element);
            });

            container.appendChild(fragment);
            document.getElementById('folder-modal').style.display = 'flex';
        }

        function openDiscordModal() { document.getElementById('discord-modal').style.display = 'flex'; }
        function openDonateModal() { document.getElementById('donate-modal').style.display = 'flex'; }
        function openLogoutModal() { document.getElementById('logout-modal').style.display = 'flex'; }
        function closeModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
            if (modalId === 'generic-modal' && window._tzHiddenForPro) {
                window._tzHiddenForPro = false;
                const tz = document.getElementById('tz-warning-overlay');
                if (tz) tz.style.display = 'flex';
            }
        }
        function showGenericModal(title, message) {
            document.getElementById('generic-title').style.display = 'block';
            document.getElementById('generic-title').innerText = title;
            document.getElementById('generic-msg').innerText = message;
            document.getElementById('generic-modal').style.display = 'flex';
        }
        function openLockedApp(app) {
            if (!app || !app.id) { showProUpsell('ReKindle+'); return; }
            // Every locked app has a preview page (a generic one for apps with
            // no bespoke sample), so the tile never dead-ends in a paywall.
            window.location.href = 'preview.html?app=' + encodeURIComponent(app.id);
        }
        function showProUpsell(appName) {
            window._proUpsellApp = appName || window._proUpsellApp || 'ReKindle+';
            const tzPrompt = document.getElementById('tz-warning-overlay');
            if (tzPrompt && getComputedStyle(tzPrompt).display !== 'none') {
                tzPrompt.style.display = 'none';
                window._tzHiddenForPro = true;
            }
            const title = document.getElementById('generic-title');
            if (title) title.style.display = 'none';
            const headline = window.tFormat
                ? window.tFormat('paywall.unlock_app', { app: appName }, 'Unlock ${app} with ReKindle+')
                : 'Unlock ' + appName + ' with ReKindle+';
            const desc = window.t('paywall.desc', 'All 13 ReKindle+ apps, cloud storage and AI, in one membership.');
            const benefits = [
                window.t('paywall.benefit.apps', 'All 13 ReKindle+ apps'),
                window.t('paywall.benefit.cloud', 'Cloud storage, sync and AI'),
                window.t('paywall.benefit.cancel', 'Cancel anytime; lifetime option available')
            ];
            const price = window.t('paywall.price', '$2/month \u00b7 $15/year \u00b7 $30 lifetime');
            const sub = window.t('paywall.subscribe', 'Subscribe \u2014 from $2/month');
            const life = window.t('paywall.popup.btn.lifetime', 'Lifetime \u2014 $30 once');
            const see = window.t('paywall.see', "See what's included");
            const why = window.t('paywall.why.link', 'Why is this paid?');
            document.getElementById('generic-msg').innerHTML =
                `<p style="font-weight:bold;margin:0 0 8px;">${headline}</p>` +
                `<p style="font-size:0.9rem;line-height:1.4;margin:0 0 10px;">${desc}</p>` +
                `<ul style="text-align:left;font-size:0.85rem;line-height:1.5;margin:0 0 10px;padding-left:18px;">` +
                benefits.map(function (b) { return `<li>${b}</li>`; }).join('') + `</ul>` +
                `<p style="font-weight:bold;margin:0 0 12px;">${price}</p>` +
                `<div style="display:flex;flex-wrap:wrap;justify-content:center;">` +
                `<button class="sys-btn" onclick="location.href='pay.html'" style="margin:5px;">${sub}</button>` +
                `<button class="sys-btn" onclick="location.href='pay.html?plan=lifetime'" style="margin:5px;">${life}</button>` +
                `</div>` +
                `<p style="font-size:0.8rem;margin:12px 0 0;"><a href="help.html#pro">${see}</a></p>` +
                `<p style="font-size:0.8rem;margin:6px 0 0;"><a href="#" onclick="showWhyPaid(); return false;">${why}</a></p>`;
            document.getElementById('generic-modal').style.display = 'flex';
        }

        function showWhyPaid() {
            const appName = window._proUpsellApp || 'ReKindle+';
            const title = window.t('paywall.why.title', 'Why ReKindle+ is paid');
            const body = window.t('paywall.why.body',
                'I want to keep ReKindle ad-free and open. ReKindle+ covers the growing cost of mail sync, AI, cloud storage and photo processing, and keeps development active. The dashboard, reader, games and most tools stay free — the membership is optional, and you can cancel anytime.');
            const back = window.t('paywall.why.back', 'Back to ReKindle+');
            const plans = window.t('paywall.get', 'Get ReKindle+');
            document.getElementById('generic-msg').innerHTML =
                `<p style="font-weight:bold;margin:0 0 10px;">${title}</p>` +
                `<p style="font-size:0.9rem;line-height:1.5;margin:0 0 14px;text-align:left;">${body}</p>` +
                `<div style="display:flex;flex-wrap:wrap;justify-content:center;">` +
                `<button class="sys-btn" onclick="showProUpsell(window._proUpsellApp || 'ReKindle+')" style="margin:5px;">${back}</button>` +
                `<button class="sys-btn" onclick="location.href='pay.html'" style="margin:5px;">${plans}</button>` +
                `</div>`;
            document.getElementById('generic-modal').style.display = 'flex';
        }
        // Shared empty-field guard for the sign-in and registration forms. The
        // wording differs per form, so each caller supplies its own message.
        function credentialsMissing(username, password) {
            return !username || !password;
        }
        async function doLogin() {
            document.getElementById('login-msg').innerText = "Connecting...";
            // Set the guard before the SDK load too: a service-worker
            // controllerchange reload during boot would otherwise abort the
            // sign-in the same way it used to abort signInWithEmailAndPassword.
            window.__rkAuthBusy = true;
            await bootFirebaseAuth();
            if (!isFirebaseAvailable || !auth) {
                window.__rkAuthBusy = false;
                document.getElementById('login-msg').innerText = "Error: Offline / No Database Connection";
                return;
            }
            const u = document.getElementById('username').value;
            const p = document.getElementById('password').value;
            if (credentialsMissing(u, p)) {
                window.__rkAuthBusy = false;
                document.getElementById('login-msg').innerText = "Error: Please enter a valid username and password.";
                return;
            }
            try {
                await ensureAuthPersistence();
                const email = u.includes('@') ? u : u + "@rekindle.ink";
                await auth.signInWithEmailAndPassword(email, p);
                try { localStorage.removeItem('rekindle_was_pro'); } catch (e) { }
                // After sign-in, call the server to verify the IP. The function uses
                // the real server-side IP (not spoofable) and revokes the session if banned.
                await ensureFirebaseFunctions();
                const ipResult = await RekindleIpBan.checkOnLogin();
                if (ipResult.banned) {
                    await auth.signOut();
                    document.getElementById('login-msg').innerText = "Error: Your IP address has been banned from this network.";
                } else if (typeof window.rekindleRestoreTimezoneFromProfile === 'function') {
                    // The timezone popup's "Sign in instead" button sends users
                    // here. Now that we have a session, pull the account's saved
                    // timezone back into localStorage and drop the prompt.
                    window.rekindleRestoreTimezoneFromProfile(auth.currentUser);
                }
                finishLoginRedirect();
            } catch (e) {
                const msg = (e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found')
                    ? "Invalid username or password."
                    : (e.message || "Login failed.");
                document.getElementById('login-msg').innerText = "Error: " + msg;
            } finally {
                window.__rkAuthBusy = false;
            }
        }

        // Persist the session in localStorage before the first sign-in so a page
        // load that lands mid-flow can restore it. Best effort: a browser that
        // refuses setPersistence still signs in with the SDK default.
        let authPersistenceReady = false;
        async function ensureAuthPersistence() {
            if (authPersistenceReady || !auth || !firebase.auth.Auth || !firebase.auth.Auth.Persistence) return;
            try {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                authPersistenceReady = true;
            } catch (e) {
                console.warn('[auth] setPersistence(LOCAL) unavailable:', e && e.message ? e.message : e);
            }
        }
        const isForbiddenUsername = (u) => { const forbidden = ["root", "system", "admin", "administrator", "mod", "moderator", "support", "ukiyo", "rekindle", "wantban", "kindlehub", "khub", "unreader", "inkchat"]; const lowerU = u.toLowerCase(); return forbidden.some(word => lowerU.includes(word)); };
        // bad_words.js is ~18 KB compressed and the dashboard only ever uses it
        // for one username check on the register form, so it loads on first use
        // instead of on every visit (2026-10-26 load-path pass).
        let badWordsPromise = null;
        function ensureBadWords() {
            if (window.filterBadWords) return Promise.resolve();
            if (badWordsPromise) return badWordsPromise;
            badWordsPromise = new Promise(function (resolve) {
                const s = document.createElement('script');
                s.src = 'bad_words.js?v=4';
                s.onload = resolve;
                s.onerror = resolve;
                document.head.appendChild(s);
            });
            return badWordsPromise;
        }
        const isBadWord = (u) => {
            if (!window.filterBadWords) return false;
            return window.filterBadWords(u) !== u;
        };
        async function doRegister() {
            await bootFirebaseAuth();
            if (!isFirebaseAvailable || !auth) { document.getElementById('login-msg').innerText = "Error: Offline / No Database Connection"; return; }
            const u = document.getElementById('username').value.trim();
            const p = document.getElementById('password').value;
            if (credentialsMissing(u, p)) { document.getElementById('login-msg').innerText = "Error: Please enter a username and password."; return; }
            if (u.length > 20) { document.getElementById('login-msg').innerText = "Error: Username must be 20 characters or less."; return; }
            if (!/^[a-zA-Z0-9]+$/.test(u)) { document.getElementById('login-msg').innerText = "Error: Username can only contain letters and numbers."; return; }
            if (u.includes('@')) { document.getElementById('login-msg').innerText = "Error: Please enter a username only, not an email."; return; }
            if (isForbiddenUsername(u)) { document.getElementById('login-msg').innerText = "Error: Forbidden username."; return; }
            await ensureBadWords();
            if (isBadWord(u)) { document.getElementById('login-msg').innerText = "Error: Username contains inappropriate language."; return; }

            document.getElementById('login-msg').innerText = "Registering...";
            window.__rkAuthBusy = true;
            try {
                await ensureAuthPersistence();
                await ensureFirebaseFunctions();
                // Registration goes through a Cloud Function so the IP ban check
                // runs server-side — it cannot be bypassed via browser dev tools.
                const registerUser = firebase.functions().httpsCallable('registerUser');
                const result = await registerUser({ username: u, password: p });
                await auth.signInWithCustomToken(result.data.customToken);
                try { localStorage.removeItem('rekindle_was_pro'); } catch (e) { }
                finishLoginRedirect();
            } catch (e) {
                const msg = e.message || "";
                // Fallback: if the account was created but custom-token generation failed
                // (e.g. IAM misconfiguration), sign in with email/password instead.
                if (msg.includes("Please log in with your username and password.")) {
                    document.getElementById('login-msg').innerText = "Finalising sign-in...";
                    try {
                        await auth.signInWithEmailAndPassword(`${u}@rekindle.ink`, p);
                        finishLoginRedirect();
                        return;
                    } catch (loginErr) {
                        document.getElementById('login-msg').innerText = "Error: " + (loginErr.message || "Sign-in failed.");
                        return;
                    }
                }
                document.getElementById('login-msg').innerText = "Error: " + msg;
            } finally {
                window.__rkAuthBusy = false;
            }
        }
        function confirmLogout() {
            if (isFirebaseAvailable && auth) auth.signOut().catch(e => console.error("Sign out error:", e));
            localStorage.removeItem('rekindle_uid'); localStorage.removeItem('rekindle_favorites');
            localStorage.removeItem('rekindle_was_pro');
            closeModal('logout-modal'); location.reload();
        }
        function autoDetectScale() { if (window.rekindleAutoDetectScale) window.rekindleAutoDetectScale(); }
        function updateProUI() {
            const titlePlus = document.getElementById('title-plus');
            if (isPro) { if (titlePlus) titlePlus.style.display = 'inline-block'; }
            else { if (titlePlus) titlePlus.style.display = 'none'; }
            renderPlusNudge();
        }
        function drawAvatar(canvasOrId, seed) {
            const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#000';
            if (seed === 'blank') return; // deliberately empty avatar (report 2026-11-10)
            if (Array.isArray(seed)) {
                const gridSize = Math.sqrt(seed.length);
                const pixelSize = canvas.width / gridSize;
                for (let i = 0; i < seed.length; i++) {
                    const v = seed[i];
                    if (v > 0) {
                        const x = i % gridSize;
                        const y = Math.floor(i / gridSize);
                        if (v < 1) {
                            const s = Math.round((1 - v) * 255);
                            ctx.fillStyle = 'rgb(' + s + ',' + s + ',' + s + ')';
                        }
                        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
                        if (v < 1) ctx.fillStyle = '#000';
                    }
                }
                return;
            }
            let hash = 0;
            const str = String(seed);
            for (let i = 0; i < str.length; i++) {
                hash = str.charCodeAt(i) + ((hash << 5) - hash);
            }
            const gridSize = 16;
            const pixelSize = canvas.width / gridSize;
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < gridSize; y++) {
                    const bitIndex = (x * gridSize + y) % 32;
                    const secondary = ((hash >> 3) ^ (hash << 7)) + (y * 17);
                    const val = ((hash >> bitIndex) ^ (secondary >> (bitIndex % 16))) & 1;
                    const distFromCenter = Math.abs(y - 8) + Math.abs(x - 4);
                    const fillChance = distFromCenter < 6 ? val : (val && ((hash >> (x + y)) & 3) === 0);
                    if (fillChance) {
                        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
                        ctx.fillRect((gridSize - 1 - x) * pixelSize, y * pixelSize, pixelSize, pixelSize);
                    }
                }
            }
        }

        // A neutral silhouette for guests. The old blank white canvas looked
        // like an unchecked checkbox in the menu bar next to "Guest Mode".
        function drawGuestAvatar(canvas) {
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const u = canvas.width / 16;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#000';
            ctx.fillRect(5 * u, 3 * u, 6 * u, 5 * u);
            ctx.fillRect(4 * u, 9 * u, 8 * u, 2 * u);
            ctx.fillRect(3 * u, 11 * u, 10 * u, 4 * u);
            ctx.fillStyle = '#fff';
            ctx.fillRect(7 * u, 9 * u, 2 * u, 2 * u);
        }

        // --- DASHBOARD WIDGETS LOGIC ---
        // Format dates with the app language only. time.js' getUserLocale()
        // appends the location country (fr-AU), and WebKit falls back to the
        // device locale for unsupported combinations, which printed an English
        // date on a French dashboard.
        function dashboardDateLocale() {
            var locale = '';
            try { locale = localStorage.getItem('rekindle_language') || ''; } catch (e) { /* storage disabled */ }
            if (!locale || locale === 'auto') locale = document.documentElement.lang || 'en';
            return locale;
        }

        function updateDashboardTime() {
            try {
                let now = new Date();
                if (typeof window.rekindleGetZonedDate === 'function') {
                    now = window.rekindleGetZonedDate();
                }
                let h = now.getHours();
                let m = now.getMinutes();
                let ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                m = m < 10 ? '0' + m : m;
                const tv = document.getElementById('db-time-val');
                const dv = document.getElementById('db-date-val');
                if (tv) tv.textContent = h + ':' + m + ' ' + ampm;
                if (dv) {
                    try {
                        dv.textContent = now.toLocaleDateString(dashboardDateLocale(), { weekday: 'long', month: 'long', day: 'numeric' });
                    } catch (e) {
                        dv.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    }
                }
                updateDashboardWorldClocks();
            } catch(e) {}
        }

        let cachedWorldClocks = null;
        let cachedWorldClocksKey = null;

        function readWorldClocks() {
            let raw = null;
            let locationRaw = null;
            try {
                raw = localStorage.getItem('rekindle_clocks');
                locationRaw = localStorage.getItem('rekindle_location_manual');
            } catch (e) { /* storage disabled */ }
            const cacheKey = (raw || '') + '|' + (locationRaw || '');
            if (cachedWorldClocks && cachedWorldClocksKey === cacheKey) return cachedWorldClocks;

            let cities = null;
            if (raw) {
                try {
                    const decoded = atob(raw);
                    let res = '';
                    for (let i = 0; i < decoded.length; i++) {
                        res += String.fromCharCode(decoded.charCodeAt(i) ^ 'rek'.charCodeAt(i % 3));
                    }
                    cities = JSON.parse(res);
                } catch (e) { cities = null; }
            }

            if (!cities || !cities.length) {
                cities = [];
                let local = null;
                if (locationRaw) {
                    try {
                        const loc = JSON.parse(locationRaw);
                        if (loc && loc.zone && loc.name) local = { name: loc.name, zone: loc.zone };
                    } catch (e) { /* bad JSON */ }
                }
                if (local) cities.push(local);
                const fallbacks = [
                    { name: 'London', zone: 'Europe/London' },
                    { name: 'Tokyo', zone: 'Asia/Tokyo' },
                    { name: 'New York', zone: 'America/New_York' }
                ];
                for (let i = 0; i < fallbacks.length && cities.length < 3; i++) {
                    let duplicate = false;
                    for (let j = 0; j < cities.length; j++) {
                        if (cities[j].zone === fallbacks[i].zone) duplicate = true;
                    }
                    if (!duplicate) cities.push(fallbacks[i]);
                }
            }

            cachedWorldClocks = cities;
            cachedWorldClocksKey = cacheKey;
            return cities;
        }

        function updateDashboardWorldClocks() {
            var container = document.getElementById('db-world-clocks');
            if (!container) return;
            var cities = readWorldClocks();
            var html = '';
            var now = new Date();
            if (typeof window.rekindleGetZonedDate === 'function') {
                now = window.rekindleGetZonedDate();
            }
            for (var i = 0; i < cities.length; i++) {
                var city = cities[i];
                var zoned = now;
                if (city.zone && typeof window.rekindleGetDateInZone === 'function') {
                    zoned = window.rekindleGetDateInZone(now, city.zone);
                }
                var h = zoned.getHours();
                var m = zoned.getMinutes();
                var ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                m = m < 10 ? '0' + m : m;
                html += '<div class="db-world-clock-row"><span class="db-world-clock-name">' +
                    escapeHomeHtml(city.name) + '</span><span class="db-world-clock-time">' +
                    h + ':' + m + ' ' + ampm + '</span></div>';
            }
            container.innerHTML = html;
        }

        let currentCalMonth = null;
        let currentCalYear = null;
        let currentCalSelectedDay = null;

        function selectDashboardCalendarDay(day) {
            currentCalSelectedDay = day;
            renderDashboardCalendar();
            fetchDashboardAgenda();
        }

        function selectDashboardCalendarToday() {
            const now = typeof window.rekindleGetZonedDate === 'function' ? window.rekindleGetZonedDate() : new Date();
            currentCalMonth = now.getMonth();
            currentCalYear = now.getFullYear();
            currentCalSelectedDay = now.getDate();
            renderDashboardCalendar();
            fetchDashboardAgenda(true);
        }

        function openDashboardCalendar(event) {
            if (event) event.preventDefault();
            let y = currentCalYear;
            let m = currentCalMonth;
            let d = currentCalSelectedDay;
            if (y === null || m === null || d === null) {
                const now = typeof window.rekindleGetZonedDate === 'function' ? window.rekindleGetZonedDate() : new Date();
                y = now.getFullYear(); m = now.getMonth(); d = now.getDate();
            }
            const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            window.location.href = 'calendar.html?date=' + y + '-' + pad(m + 1) + '-' + pad(d);
            return false;
        }

        function addDashboardEvent(event) {
            if (event) event.preventDefault();
            let y = currentCalYear;
            let m = currentCalMonth;
            let d = currentCalSelectedDay;
            if (y === null || m === null || d === null) {
                const now = typeof window.rekindleGetZonedDate === 'function' ? window.rekindleGetZonedDate() : new Date();
                y = now.getFullYear(); m = now.getMonth(); d = now.getDate();
            }
            const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            window.location.href = 'calendar.html?date=' + y + '-' + pad(m + 1) + '-' + pad(d) + '&new=1';
        }

        function changeDashboardCalendar(delta) {
            if (currentCalMonth === null || currentCalYear === null) {
                let now = typeof window.rekindleGetZonedDate === 'function' ? window.rekindleGetZonedDate() : new Date();
                currentCalMonth = now.getMonth();
                currentCalYear = now.getFullYear();
            }
            currentCalMonth += delta;
            if (currentCalMonth > 11) {
                currentCalMonth = 0;
                currentCalYear++;
            } else if (currentCalMonth < 0) {
                currentCalMonth = 11;
                currentCalYear--;
            }
            currentCalSelectedDay = null;
            renderDashboardCalendar();
            fetchDashboardAgenda();
        }

        function getIcon(code, isLarge) {
            const s = isLarge ? 2.5 : 2;
            if (code === 0) return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" stroke="black" stroke-width="${s}" fill="none"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="black" stroke-width="${s}"/></svg>`;
            if (code <= 3) return `<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="black" stroke-width="${s}" fill="none"/></svg>`;
            if (code <= 48) return `<svg viewBox="0 0 24 24"><path d="M4 10h16M4 14h16M4 18h16" stroke="black" stroke-width="${s}"/></svg>`;
            if (code <= 67) return `<svg viewBox="0 0 24 24"><path d="M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" stroke="black" stroke-width="${s}" fill="none"/></svg>`;
            if (code <= 86) return `<svg viewBox="0 0 24 24"><path d="M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" stroke="black" stroke-width="${s}" fill="none"/></svg>`;
            if (code <= 99) return `<svg viewBox="0 0 24 24"><path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9" stroke="black" stroke-width="${s}" fill="none"/><polyline points="13 11 9 17 15 17 11 23" stroke="black" stroke-width="${s}" fill="none"/></svg>`;
            return `<svg viewBox="0 0 24 24"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" stroke="black" stroke-width="${s}" fill="none"/><line x1="12" y1="15" x2="12" y2="21" stroke="black" stroke-width="${s}" stroke-dasharray="2 2"/></svg>`;
        }
        
        const WEATHER_CACHE_KEY = 'rekindle_weather_cache_v1';
        const WEATHER_CACHE_TTL = 15 * 60 * 1000;
        let weatherSeq = 0;

        function readWeatherCache() {
            try {
                const raw = localStorage.getItem(WEATHER_CACHE_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (parsed && parsed.data && parsed.data.current_weather && parsed.fetchedAt) return parsed;
            } catch (e) { /* corrupt cache */ }
            return null;
        }

        function writeWeatherCache(record) {
            try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(record)); } catch (e) { /* storage full */ }
        }

        function weatherSettings() {
            let lat = 40.7128, lon = -74.0060, unit = 'fahrenheit';
            let locName = 'New York';
            let locManual = null;
            try { locManual = localStorage.getItem('rekindle_location_manual'); } catch (e) { /* storage disabled */ }

            if (locManual) {
                try {
                    const lm = JSON.parse(locManual);
                    if (lm.lat && lm.lon) {
                        lat = lm.lat; lon = lm.lon;
                        unit = (lm.country_code === 'US' || lm.country_code === 'LR' || lm.country_code === 'MM') ? 'fahrenheit' : 'celsius';
                        if (lm.name) locName = lm.name;
                    }
                } catch (e) { /* bad JSON */ }
            }

            let wSettings = null;
            try { wSettings = localStorage.getItem('rekindle_weather_settings'); } catch (e) { /* storage disabled */ }
            if (wSettings) {
                try {
                    const st = JSON.parse(wSettings);
                    if (st.locations && st.locations.length > 0) {
                        const loc = st.locations[st.currentIndex || 0];
                        const isDefaultNY = Math.abs(loc.lat - 40.7128) < 0.1 && loc.city === 'New York';
                        if (!isDefaultNY || !locManual) {
                            lat = loc.lat || lat;
                            lon = loc.long || lon;
                            unit = loc.autoUnit || unit;
                            if (loc.city) locName = loc.city;
                        }
                    }
                } catch (e) { /* bad JSON */ }
            }

            return { lat: lat, lon: lon, unit: unit, locName: locName };
        }

        function formatWeatherClock(iso) {
            if (!iso) return '';
            const part = String(iso).split('T')[1];
            if (!part) return '';
            const bits = part.split(':');
            let h = parseInt(bits[0], 10);
            const m = bits[1] || '00';
            if (isNaN(h)) return '';
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            return h + ':' + m + ' ' + ampm;
        }

        function renderWeatherUpdated(timestamp) {
            const el = document.getElementById('db-weather-updated');
            if (!el) return;
            if (!timestamp) { el.textContent = ''; el.title = ''; return; }
            const mins = Math.round((Date.now() - timestamp) / 60000);
            const age = mins < 1 ? 'now' : (mins < 60 ? mins + 'm' : Math.round(mins / 60) + 'h');
            const label = window.t ? window.t('dashboard.status.updated', 'Updated') : 'Updated';
            el.textContent = label + ' ' + age;
            try { el.title = new Date(timestamp).toLocaleString(); } catch (e) { el.title = ''; }
        }

        function renderWeatherExtra(data, startIdx, unit) {
            const container = document.getElementById('db-weather-extra');
            if (!container) return;
            const items = [];
            const label = function (key, fallback) {
                return window.t ? window.t(key, fallback) : fallback;
            };
            const item = function (key, fallback, value) {
                return '<span class="db-wx-item"><span class="db-wx-label">' + label(key, fallback) + '</span> ' + value + '</span>';
            };

            if (data.hourly && data.hourly.apparent_temperature && startIdx >= 0 &&
                typeof data.hourly.apparent_temperature[startIdx] === 'number') {
                items.push(item('weather.label.feels', 'Feels', Math.round(data.hourly.apparent_temperature[startIdx]) + '°'));
            }
            if (data.hourly && data.hourly.precipitation_probability && startIdx >= 0 &&
                typeof data.hourly.precipitation_probability[startIdx] === 'number') {
                items.push(item('weather.cond.rain', 'Rain', Math.round(data.hourly.precipitation_probability[startIdx]) + '%'));
            }
            if (data.current_weather && typeof data.current_weather.windspeed === 'number') {
                const windUnit = unit === 'fahrenheit' ? 'mph' : 'km/h';
                items.push(item('weather.label.wind', 'WIND', Math.round(data.current_weather.windspeed) + ' ' + windUnit));
            }
            if (data.daily && data.daily.sunrise && data.daily.sunrise[0]) {
                const rise = formatWeatherClock(data.daily.sunrise[0]);
                if (rise) items.push(item('weather.label.sunrise', 'Sunrise', rise));
            }
            if (data.daily && data.daily.sunset && data.daily.sunset[0]) {
                const set = formatWeatherClock(data.daily.sunset[0]);
                if (set) items.push(item('weather.label.sunset', 'Sunset', set));
            }
            container.innerHTML = items.join('');
        }

        function renderDashboardWeather(data, record) {
            if (!data || !data.current_weather) return;
            const locEl = document.getElementById('db-weather-loc');
            if (locEl && record.locName) locEl.textContent = record.locName;

            const tw = document.getElementById('db-weather-temp');
            const dw = document.getElementById('db-weather-desc');
            const hl = document.getElementById('db-weather-highlow');
            if (tw) tw.textContent = Math.round(data.current_weather.temperature) + '°';
            const code = data.current_weather.weathercode;

            const dbIcon = document.getElementById('db-weather-icon');
            if (dbIcon) {
                dbIcon.innerHTML = getIcon(code, true);
                dbIcon.style.display = 'block';
            }

            let descKey = 'weather.cond.clear';
            let desc = 'Clear Sky';
            if (code === 1 || code === 2 || code === 3) { descKey = 'weather.cond.cloudy'; desc = 'Cloudy'; }
            if (code >= 45 && code <= 48) { descKey = 'weather.cond.fog'; desc = 'Fog'; }
            if (code >= 51 && code <= 57) { descKey = 'weather.cond.drizzle'; desc = 'Drizzle'; }
            if (code >= 61 && code <= 65) { descKey = 'weather.cond.rain'; desc = 'Rain'; }
            if (code >= 71 && code <= 77) { descKey = 'weather.cond.snow'; desc = 'Snow'; }
            if (code >= 80 && code <= 82) { descKey = 'weather.cond.showers'; desc = 'Showers'; }
            if (code >= 95) { descKey = 'weather.cond.thunderstorm'; desc = 'Thunderstorm'; }
            if (dw) dw.textContent = window.t ? window.t(descKey, desc) : desc;

            if (hl && data.daily && data.daily.temperature_2m_max && data.daily.temperature_2m_min) {
                const high = window.t ? window.t('weather.label.high', 'H') : 'H';
                const low = window.t ? window.t('weather.label.low', 'L') : 'L';
                hl.textContent = high + ':' + Math.round(data.daily.temperature_2m_max[0]) + '° ' +
                    low + ':' + Math.round(data.daily.temperature_2m_min[0]) + '°';
            }

            let startIdx = -1;
            if (data.hourly && data.hourly.time) {
                const nowZoned = window.rekindleGetDateInZone ? window.rekindleGetDateInZone(new Date(), data.timezone) : new Date();
                const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
                const nowKey = nowZoned.getFullYear() + '-' + pad(nowZoned.getMonth() + 1) + '-' + pad(nowZoned.getDate()) +
                    'T' + pad(nowZoned.getHours()) + ':' + pad(nowZoned.getMinutes());
                for (let i = 0; i < data.hourly.time.length; i++) {
                    if (data.hourly.time[i] >= nowKey) { startIdx = i; break; }
                }
            }

            renderWeatherExtra(data, startIdx, record.unit);

            const hourlyContainer = document.getElementById('db-weather-hourly');
            if (hourlyContainer && data.hourly && data.hourly.time && startIdx !== -1) {
                let html = '';
                for (let i = startIdx; i < startIdx + 24 && i < data.hourly.time.length; i++) {
                    const date = new Date(data.hourly.time[i]);
                    let hourLabel;
                    try {
                        hourLabel = date.toLocaleTimeString(dashboardDateLocale(), { hour: 'numeric', hour12: true });
                    } catch (e) {
                        hourLabel = date.toLocaleTimeString([], { hour: 'numeric', hour12: true });
                    }
                    const ht = Math.round(data.hourly.temperature_2m[i]);
                    const hc = data.hourly.weathercode[i];
                    html += `<div class="db-hour">
                        <div class="db-hour-label">${hourLabel}</div>
                        <div class="db-hour-icon">${getIcon(hc, false)}</div>
                        <div class="db-hour-temp">${ht}°</div>
                    </div>`;
                }
                hourlyContainer.innerHTML = html;
                hourlyContainer.style.display = html ? 'flex' : 'none';
            }

            renderWeatherUpdated(record.fetchedAt);
        }

        async function fetchDashboardWeather(force) {
            const meta = weatherSettings();
            const seq = ++weatherSeq;
            const locEl = document.getElementById('db-weather-loc');
            if (locEl) locEl.textContent = meta.locName;

            const cached = readWeatherCache();
            const cacheMatches = !!(cached && cached.lat === meta.lat && cached.lon === meta.lon && cached.unit === meta.unit);
            if (cacheMatches) {
                renderDashboardWeather(cached.data, cached);
                if (!force && Date.now() - cached.fetchedAt < WEATHER_CACHE_TTL) return;
            }

            let controller = null;
            let timer = null;
            try {
                if (typeof AbortController !== 'undefined') {
                    controller = new AbortController();
                    timer = setTimeout(function () { controller.abort(); }, 8000);
                }
                const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + meta.lat +
                    '&longitude=' + meta.lon +
                    '&current_weather=true' +
                    '&hourly=temperature_2m,weathercode,apparent_temperature,precipitation_probability,wind_speed_10m' +
                    '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset' +
                    '&timezone=auto&temperature_unit=' + meta.unit +
                    '&wind_speed_unit=' + (meta.unit === 'fahrenheit' ? 'mph' : 'kmh');
                const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
                if (!res.ok) throw new Error('Weather API failed');
                const data = await res.json();
                if (seq !== weatherSeq) return;
                if (!data.current_weather) throw new Error('Weather payload missing current_weather');
                const record = {
                    lat: meta.lat,
                    lon: meta.lon,
                    unit: meta.unit,
                    locName: meta.locName,
                    data: data,
                    fetchedAt: Date.now()
                };
                writeWeatherCache(record);
                renderDashboardWeather(data, record);
            } catch (e) {
                if (seq !== weatherSeq) return;
                if (!cacheMatches) {
                    const dw = document.getElementById('db-weather-desc');
                    if (dw) dw.textContent = window.t ? window.t('weather.status.error', 'Connection Error') : 'Unavailable';
                    const tw = document.getElementById('db-weather-temp');
                    if (tw) tw.textContent = '--°';
                    const updated = document.getElementById('db-weather-updated');
                    if (updated) updated.textContent = '';
                }
            } finally {
                if (timer) clearTimeout(timer);
            }
        }


        function renderDashboardCalendar() {
            try {
                let now = new Date();
                if (typeof window.rekindleGetZonedDate === 'function') now = window.rekindleGetZonedDate();
                
                if (currentCalMonth === null || currentCalYear === null) {
                    currentCalMonth = now.getMonth();
                    currentCalYear = now.getFullYear();
                }

                const month = currentCalMonth;
                const year = currentCalYear;
                
                if (currentCalSelectedDay === null) {
                    if (now.getMonth() === month && now.getFullYear() === year) {
                        currentCalSelectedDay = now.getDate();
                    } else {
                        currentCalSelectedDay = 1;
                    }
                }

                const today = (now.getMonth() === month && now.getFullYear() === year) ? now.getDate() : -1;

                const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                const cTitle = document.getElementById('db-calendar-month-text') || document.getElementById('db-calendar-title');
                if (cTitle) {
                    let monthTitle = monthNames[month] + " " + year;
                    try {
                        monthTitle = new Date(year, month, 1).toLocaleDateString(dashboardDateLocale(), { month: 'long', year: 'numeric' });
                    } catch (e) { /* keep the English fallback */ }
                    cTitle.textContent = monthTitle;
                }
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const grid = document.getElementById('db-calendar-grid');
                if (!grid) return;
                let weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
                try {
                    const localWeekdays = [];
                    // 2024-01-07 is a Sunday, so this walks Sun..Sat.
                    for (let wi = 0; wi < 7; wi++) {
                        localWeekdays.push(new Date(2024, 0, 7 + wi).toLocaleDateString(dashboardDateLocale(), { weekday: 'short' }));
                    }
                    if (localWeekdays.length === 7 && localWeekdays[0]) weekdayLabels = localWeekdays;
                } catch (e) { /* keep the English headers */ }
                let html = '';
                for (let hi = 0; hi < 7; hi++) {
                    html += '<div class="dashboard-calendar-day-header">' + weekdayLabels[hi] + '</div>';
                }
                for (let i = 0; i < firstDay; i++) html += '<div class="dashboard-calendar-day"></div>';
                for (let i = 1; i <= daysInMonth; i++) {
                    let cls = "dashboard-calendar-day";
                    if (i === today) cls += " today";
                    if (i === currentCalSelectedDay && i !== today) cls += " selected";
                    html += '<div class="' + cls + '" role="button" tabindex="0" aria-label="' + i +
                        '" style="cursor:pointer;" onclick="selectDashboardCalendarDay(' + i + ')" ' +
                        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();selectDashboardCalendarDay(' + i + ');}">' + i + '</div>';
                }
                grid.innerHTML = html;
            } catch(e) {}
        }
        
        const AGENDA_CACHE_TTL = 5 * 60 * 1000;
        let agendaMonthCache = {};
        let agendaFetchSeq = 0;
        let agendaFirestorePending = false;

        function escapeHomeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function agendaMonthKey(y, m) { return y + '-' + m; }

        function normalizeAgendaStart(start) {
            if (start && typeof start.toDate === 'function') return start.toDate();
            if (start && typeof start.seconds === 'number') return new Date(start.seconds * 1000);
            return new Date(start);
        }

        function agendaEventParts(event) {
            if (event && event.isAllDay && typeof event.start === 'string') {
                const bits = event.start.split('-');
                if (bits.length >= 3) {
                    return { y: parseInt(bits[0], 10), m: parseInt(bits[1], 10) - 1, d: parseInt(bits[2], 10) };
                }
            }
            let date = normalizeAgendaStart(event && event.start);
            if (typeof window.rekindleGetZonedDate === 'function') date = window.rekindleGetZonedDate(date);
            return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
        }

        function agendaSortValue(event) {
            if (event && event.isAllDay && typeof event.start === 'string') {
                const bits = event.start.split('-');
                return new Date(parseInt(bits[0], 10), parseInt(bits[1], 10) - 1, parseInt(bits[2], 10), 0, 0, 0).getTime();
            }
            return normalizeAgendaStart(event && event.start).getTime() || 0;
        }

        function renderAgendaList(y, m, d) {
            const listEl = document.getElementById('db-agenda-list');
            if (!listEl) return;
            const cache = agendaMonthCache[agendaMonthKey(y, m)];
            if (!cache) return;

            const updatedEl = document.getElementById('db-agenda-updated');
            if (updatedEl) {
                if (cache.fetchedAt) {
                    const mins = Math.round((Date.now() - cache.fetchedAt) / 60000);
                    const age = mins < 1 ? 'now' : (mins < 60 ? mins + 'm' : Math.round(mins / 60) + 'h');
                    const label = window.t ? window.t('dashboard.status.updated', 'Updated') : 'Updated';
                    updatedEl.textContent = label + ' ' + age;
                } else {
                    updatedEl.textContent = '';
                }
            }

            if (cache.authError) {
                const msg = window.t ? window.t('dashboard.agenda.session_expired', 'Session expired. Open Calendar to reconnect.') : 'Session expired. Open Calendar to reconnect.';
                listEl.innerHTML = '<div class="dashboard-agenda-empty">' + escapeHomeHtml(msg) + '</div>';
                return;
            }

            const dayEvents = cache.events.filter(function (event) {
                const parts = agendaEventParts(event);
                return parts.y === y && parts.m === m && parts.d === d;
            }).sort(function (a, b) { return agendaSortValue(a) - agendaSortValue(b); });

            if (dayEvents.length === 0) {
                const empty = window.t ? window.t('calendar.msg.empty', 'No events scheduled.') : 'No events scheduled.';
                listEl.innerHTML = '<div class="dashboard-agenda-empty">' + escapeHomeHtml(empty) + '</div>';
                return;
            }

            const allDayLabel = window.t ? window.t('calendar.label.all_day', 'All Day') : 'All Day';
            let html = '';
            dayEvents.forEach(function (event) {
                let timeStr = allDayLabel;
                if (!event.isAllDay) {
                    let date = normalizeAgendaStart(event.start);
                    if (typeof window.rekindleGetZonedDate === 'function') date = window.rekindleGetZonedDate(date);
                    let h = date.getHours();
                    const mi = date.getMinutes();
                    const ampm = h >= 12 ? 'p' : 'a';
                    h = h % 12 || 12;
                    timeStr = h + ':' + (mi < 10 ? '0' + mi : mi) + ampm;
                }
                html += '<div class="dashboard-agenda-item">' +
                    '<div class="dashboard-agenda-time">' + timeStr + '</div>' +
                    '<div class="dashboard-agenda-title">' + escapeHomeHtml(event.title || '') + '</div>' +
                    '</div>';
            });
            listEl.innerHTML = html;
            scheduleDashboardFit();
        }

        async function fetchDashboardAgenda(force) {
            const listEl = document.getElementById('db-agenda-list');
            if (!listEl) return;

            let now = typeof window.rekindleGetZonedDate === 'function' ? window.rekindleGetZonedDate() : new Date();
            let y = currentCalYear !== null ? currentCalYear : now.getFullYear();
            let m = currentCalMonth !== null ? currentCalMonth : now.getMonth();
            let d = currentCalSelectedDay !== null ? currentCalSelectedDay : now.getDate();
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            if (d > daysInMonth) d = daysInMonth;

            // Title (Today / "Nov 24 Events") is updated immediately, even when
            // the month is already cached.
            const subTitle = document.getElementById('db-agenda-title');
            if (subTitle) {
                if (window.t && y === now.getFullYear() && m === now.getMonth() && d === now.getDate()) {
                    subTitle.setAttribute('data-i18n', 'dashboard.agenda.today');
                    subTitle.innerText = window.t('dashboard.agenda.today', 'Today Events');
                } else {
                    subTitle.removeAttribute('data-i18n');
                    const dayDate = new Date(y, m, d, 12, 0, 0);
                    let dateStr = window.rekindleFormatWallDate ? window.rekindleFormatWallDate(dayDate, { month: 'short', day: 'numeric' }) : dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    subTitle.innerText = dateStr + (window.t ? ' ' + window.t('dashboard.agenda.events', 'Events') : ' Events');
                }
            }

            const key = agendaMonthKey(y, m);
            const cached = agendaMonthCache[key];
            if (cached) {
                renderAgendaList(y, m, d);
                if (!force && Date.now() - cached.fetchedAt < AGENDA_CACHE_TTL) return;
            } else {
                listEl.innerHTML = '<div class="dashboard-agenda-loading">' + escapeHomeHtml(window.t ? window.t('common.loading', 'Loading...') : 'Loading...') + '</div>';
            }

            const googleEnabled = localStorage.getItem('rekindle_google_calendar_enabled') === 'true';
            const calDavUrl = localStorage.getItem('rekindle_caldav_url');
            const seq = ++agendaFetchSeq;

            // A signed-in dashboard may open before Firestore finishes loading.
            // Show local events now, then refresh once the SDK is ready.
            if (!googleEnabled && !calDavUrl && currentUser && !db) {
                if (!agendaFirestorePending) {
                    agendaFirestorePending = true;
                    ensureFirestore().then(function () {
                        agendaFirestorePending = false;
                        if (currentFilter === 'dashboard') fetchDashboardAgenda(true);
                    }).catch(function () { agendaFirestorePending = false; });
                }
                const localEvents = JSON.parse(localStorage.getItem('rekindle_events_local') || '[]');
                if (!cached) {
                    agendaMonthCache[key] = { fetchedAt: 0, events: localEvents, authError: false };
                    renderAgendaList(y, m, d);
                }
                return;
            }

            let events = [];
            let authError = false;
            try {
                if (googleEnabled) {
                    const token = localStorage.getItem('google_calendar_token');
                    if (token) {
                        let sel = JSON.parse(localStorage.getItem('rekindle_selected_calendars') || '[]');
                        if (!sel.length) sel = ['primary'];
                        // One query per month (plus a 2-day edge margin) instead
                        // of one per day tap. Timezone boundaries are handled by
                        // filtering the returned events client-side.
                        const queryStart = new Date(y, m, -1);
                        const queryEnd = new Date(y, m + 1, 2);
                        for (const calId of sel) {
                            if (authError) break;
                            let pageToken = null;
                            do {
                                let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${queryStart.toISOString()}&timeMax=${queryEnd.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`;
                                if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
                                const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
                                if (res.ok) {
                                    const data = await res.json();
                                    (data.items || []).forEach(function (item) {
                                        if (!item.start) return;
                                        events.push({
                                            title: item.summary || '',
                                            start: item.start.dateTime || item.start.date,
                                            isAllDay: !!item.start.date
                                        });
                                    });
                                    pageToken = data.nextPageToken || null;
                                } else if (res.status === 401 || res.status === 403) {
                                    authError = true;
                                    break;
                                } else {
                                    break;
                                }
                            } while (pageToken);
                        }
                    } else {
                        authError = true;
                    }
                } else if (calDavUrl) {
                    if (cached && !force && Date.now() - cached.fetchedAt < AGENDA_CACHE_TTL) return;
                    const res = await fetch(`/api/proxy?url=${encodeURIComponent(calDavUrl)}`);
                    const text = await res.text();
                    const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
                    let match;
                    while ((match = veventRegex.exec(text)) !== null) {
                        const block = match[1];
                        const sumM = /SUMMARY:(.*)/.exec(block);
                        const startM = /DTSTART(?:;.*)?:(\w+)/.exec(block);
                        if (sumM && startM) {
                            const rawD = startM[1].trim();
                            const isAllDay = rawD.length === 8;
                            const tzSuffix = rawD.endsWith('Z') ? 'Z' : '';
                            const isoDate = isAllDay
                                ? `${rawD.slice(0, 4)}-${rawD.slice(4, 6)}-${rawD.slice(6, 8)}`
                                : `${rawD.slice(0, 4)}-${rawD.slice(4, 6)}-${rawD.slice(6, 8)}T${rawD.slice(9, 11)}:${rawD.slice(11, 13)}:${rawD.slice(13, 15)}${tzSuffix}`;
                            events.push({ title: sumM[1].trim(), start: isoDate, isAllDay: isAllDay });
                        }
                    }
                } else if (currentUser && db) {
                    // Bounded month read. The old code fetched the entire
                    // events collection on every day tap.
                    const monthStart = new Date(y, m, -1);
                    const monthEnd = new Date(y, m + 1, 2);
                    const snap = await db.collection('users').doc(currentUser.uid).collection('events')
                        .where('start', '>=', monthStart)
                        .where('start', '<', monthEnd)
                        .get();
                    snap.forEach(function (doc) {
                        const data = doc.data();
                        events.push({
                            title: data.title || '',
                            start: data.start,
                            isAllDay: !!data.isAllDay
                        });
                    });
                } else {
                    events = JSON.parse(localStorage.getItem('rekindle_events_local') || '[]');
                }
            } catch (e) {
                console.warn('Dashboard agenda fetch failed:', e);
                if (!googleEnabled && !calDavUrl && events.length === 0) {
                    try { events = JSON.parse(localStorage.getItem('rekindle_events_local') || '[]'); } catch (e2) { events = []; }
                }
            }

            if (seq !== agendaFetchSeq) return;
            agendaMonthCache[key] = { fetchedAt: Date.now(), events: events, authError: authError };
            renderAgendaList(y, m, d);
        }


        let dashboardLoaded = false;
        let dashboardClockInterval = null;
        let dashboardVisibilityBound = false;
        let dashboardFitTimer = null;

        function dashboardFits(section) {
            return section.scrollHeight <= section.clientHeight + 3;
        }

        // The dashboard is a single-screen glance. Rather than letting the
        // app view scroll on short/narrow screens, hide secondary readouts in
        // tiers until the section fits its flex height.
        function fitDashboard() {
            const section = document.getElementById('dashboard-section');
            if (!section || currentFilter !== 'dashboard') return;
            // A display:flex switch can be measured before the browser has
            // given the section a height; escalating on that 0px reading used
            // to jump straight to the ultra tier. Wait for the next scheduled
            // pass instead.
            if (!section.clientHeight) return;
            const levels = ['dash-compact', 'dash-minimal', 'dash-tiny', 'dash-ultra'];
            section.classList.remove('dash-compact', 'dash-minimal', 'dash-tiny', 'dash-ultra');
            void section.offsetHeight;
            if (dashboardFits(section)) {
                section.setAttribute('data-density', 'full');
                return;
            }
            for (let i = 0; i < levels.length; i++) {
                section.classList.add(levels[i]);
                void section.offsetHeight;
                if (dashboardFits(section)) {
                    section.setAttribute('data-density', levels[i].replace('dash-', ''));
                    const appView = document.querySelector('.app-view');
                    if (appView && appView.scrollTop) appView.scrollTop = 0;
                    return;
                }
            }
            section.setAttribute('data-density', 'ultra');
            const appView = document.querySelector('.app-view');
            if (appView && appView.scrollTop) appView.scrollTop = 0;
        }

        function scheduleDashboardFit() {
            if (dashboardFitTimer) clearTimeout(dashboardFitTimer);
            dashboardFitTimer = setTimeout(fitDashboard, 120);
        }

        // A cheap first guess avoids painting a full dashboard (and a
        // scrollbar) for the 120 ms before fitDashboard runs. The measured
        // pass still makes the final decision.
        function primeDashboardDensity() {
            const section = document.getElementById('dashboard-section');
            if (!section || currentFilter !== 'dashboard') return;
            const h = section.clientHeight;
            if (!h) return;
            section.classList.remove('dash-compact', 'dash-minimal', 'dash-tiny', 'dash-ultra');
            if (h < 500) section.classList.add('dash-minimal');
            else if (h < 620) section.classList.add('dash-compact');
        }

        function startDashboardClock() {
            if (!dashboardClockInterval) {
                dashboardClockInterval = setInterval(updateDashboardTime, 60000);
            }
        }

        function stopDashboardClock() {
            if (dashboardClockInterval) {
                clearInterval(dashboardClockInterval);
                dashboardClockInterval = null;
            }
        }

        function loadDashboard() {
            if (!dashboardLoaded) {
                dashboardLoaded = true;
                if (!dashboardVisibilityBound) {
                    dashboardVisibilityBound = true;
                    document.addEventListener('visibilitychange', () => {
                        if (document.hidden) {
                            stopDashboardClock();
                        } else if (currentFilter === 'dashboard') {
                            updateDashboardTime();
                            startDashboardClock();
                        }
                    });
                }
            }
            if (!document.hidden) startDashboardClock();
            updateDashboardTime();
            renderDashboardCalendar();
            primeDashboardDensity();
            scheduleDashboardFit();
            fetchDashboardWeather().then(fitDashboard).catch(function () { fitDashboard(); });
            fetchDashboardAgenda().then(fitDashboard).catch(function () { fitDashboard(); });
            setTimeout(fitDashboard, 300);
        }

        window.addEventListener('resize', function () {
            if (currentFilter === 'dashboard') scheduleDashboardFit();
        });
        window.addEventListener('orientationchange', function () {
            if (currentFilter === 'dashboard') scheduleDashboardFit();
        });

        // Expose functions needed by inline HTML handlers
        window.filterApps = filterApps;
        window.openAbout = openAbout;
        window.openDiscordModal = openDiscordModal;
        window.openDonateModal = openDonateModal;
        window.openLogin = openLogin;
        window.openResetModal = openResetModal;
        window.closeModal = closeModal;
        window.showProUpsell = showProUpsell;
        window.showWhyPaid = showWhyPaid;
        window.confirmLogout = confirmLogout;
        window.confirmReset = confirmReset;
        window.doLogin = doLogin;
        window.doRegister = doRegister;
        window.toggleEditMode = toggleEditMode;
        window.toggleFeaturedSection = toggleFeaturedSection;
        window.toggleRecentSection = toggleRecentSection;
        window.selectHomeShelf = selectHomeShelf;
        window.toggleFavorite = toggleFavorite;
        window.toggleHidden = toggleHidden;
        window.changeDashboardCalendar = changeDashboardCalendar;
        window.selectDashboardCalendarDay = selectDashboardCalendarDay;
        window.selectDashboardCalendarToday = selectDashboardCalendarToday;
        window.addDashboardEvent = addDashboardEvent;
        window.fitDashboard = fitDashboard;
        window.openDashboardCalendar = openDashboardCalendar;
        window.onAppSearchInput = onAppSearchInput;
        window.toggleAppSearch = toggleAppSearch;
        window.openAppSearch = openAppSearch;
        window.closeAppSearch = closeAppSearch;
        window.runHomeSearch = runHomeSearch;
        window.clearRecentApps = clearRecentApps;
        window.recordRecentApp = recordRecentApp;
        window.dismissPlusNudge = dismissPlusNudge;
    })();
