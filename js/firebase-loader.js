/*
 * Lazy Firebase loader for the dashboard.
 *
 * The homepage used to load app + auth + firestore + database + functions as
 * five blocking-for-DOMContentLoaded defer scripts (~176 KB compressed) before
 * it could render a single app tile. This loader keeps `firebase-app-compat`
 * plus only the services a page actually needs, and lets index.html paint the
 * shell first.
 *
 *   window.rekindleLoadFirebase(['auth'], config)
 *     -> Promise<firebase>
 *
 * - `app` is always loaded first and `initializeApp(config)` is called once.
 * - Requested services load in parallel after app; repeat requests reuse the
 *   in-flight promise.
 * - No service worker/offline fallback: if gstatic is unreachable, the promise
 *   rejects and callers must degrade to guest mode.
 */
(function () {
    'use strict';

    var BASE = 'https://www.gstatic.com/firebasejs/9.6.1/';
    var FILES = {
        app: 'firebase-app-compat.js',
        auth: 'firebase-auth-compat.js',
        firestore: 'firebase-firestore-compat.js',
        database: 'firebase-database-compat.js',
        functions: 'firebase-functions-compat.js'
    };

    var loaded = {};
    var loading = {};
    var appReady = null;

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
    }

    function loadOne(name) {
        if (!FILES[name]) return Promise.reject(new Error('Unknown Firebase service: ' + name));
        if (loaded[name]) return Promise.resolve();
        if (loading[name]) return loading[name];
        loading[name] = loadScript(BASE + FILES[name]).then(function () {
            loaded[name] = true;
        }).catch(function (err) {
            delete loading[name];
            throw err;
        });
        return loading[name];
    }

    function loadApp(config) {
        if (appReady) return appReady;
        appReady = loadOne('app').then(function () {
            if (!window.firebase) throw new Error('Firebase app SDK did not initialise');
            if (config && (!window.firebase.apps || window.firebase.apps.length === 0)) {
                window.firebase.initializeApp(config);
            }
            return window.firebase;
        }).catch(function (err) {
            appReady = null;
            throw err;
        });
        return appReady;
    }

    window.rekindleLoadFirebase = function (services, config) {
        var wanted = Array.isArray(services) ? services.slice() : [];
        return loadApp(config).then(function () {
            var jobs = [];
            for (var i = 0; i < wanted.length; i++) {
                if (wanted[i] !== 'app') jobs.push(loadOne(wanted[i]));
            }
            return Promise.all(jobs);
        }).then(function () {
            return window.firebase;
        });
    };

    window.rekindleFirebaseLoaded = loaded;
})();
