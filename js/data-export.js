/*
 * "Download my data" — a user-initiated JSON export of the main Firestore
 * account plus safe local app data.
 *
 * No Cloud Function and no server copy: the browser reads its own documents,
 * redacts secrets, and hands the user a Blob. Social posts/chat stay in the
 * social project and are deliberately out of scope for v1.
 */
(function () {
    'use strict';

    var MAX_BYTES = 8 * 1024 * 1024;
    var MAX_DOCS_PER_COLLECTION = 5000;
    var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    var CATEGORIES = {
        account: {
            label: 'Account & settings',
            collections: ['settings', 'privateSettings', 'apps']
        },
        notes: {
            label: 'Notes, tasks & journal',
            collections: ['notes', 'quick_notes', 'journal', 'tasks', 'contacts', 'events', 'habits', 'habit_history', 'food_logs', 'countdown_events']
        },
        reading: {
            label: 'Reading',
            collections: ['reading_list', 'reading_logs', 'library', 'rss_feeds', 'readlater', 'watchlist']
        },
        creative: {
            label: 'Creative',
            collections: ['mindmaps', 'pixel_drawings', 'flipnote_animations', 'chords', 'cookbook', 'sheet_music_library']
        },
        games: {
            label: 'Games',
            collections: ['interactive_games', 'word_games', 'pro_data', 'flashcards', 'flashcard_decks']
        }
    };

    // Keys that must never appear in an export, at any depth. `pro_data` holds
    // Pinterest tokens and `privateSettings/ai` can hold a BYO API key.
    var SECRET_KEY = /(password|passwd|token|secret|api[_-]?key|apikey|substack_sid|recovery|ipaddress|ip_address|refresh|access_token|customendpoint|hash|salt)/i;

    // Local keys we are willing to export. Anything else stays on the device.
    var LOCAL_ALLOW = /^(rekindle_(?!uid$|is_pro$|pro_expiry$|location|timezone|recovery|.*(token|secret|key))|pixel_|pixel_drawing_|pixel_template_|pixel_manifest|chat_|jump|surfer|oregontrail|mystery|chords|journal|notes|tasks)/i;

    function sanitize(value, depth) {
        depth = depth || 0;
        if (depth > 8) return '[depth limit]';
        if (value === null || value === undefined) return value;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(function (item) { return sanitize(item, depth + 1); });
        if (typeof value !== 'object') return value;

        // Firestore Timestamp / GeoPoint / DocumentReference
        if (typeof value.toDate === 'function') {
            try { return value.toDate().toISOString(); } catch (e) { return '[timestamp]'; }
        }
        if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
            return { latitude: value.latitude, longitude: value.longitude };
        }
        if (value.path && typeof value.path === 'string' && value.firestore) return '[reference]';

        var out = {};
        Object.keys(value).forEach(function (key) {
            if (SECRET_KEY.test(key)) return;
            out[key] = sanitize(value[key], depth + 1);
        });
        return out;
    }

    function readLocalStorage() {
        var out = {};
        var storage;
        try { storage = window.localStorage; } catch (e) { return out; }
        if (!storage) return out;
        for (var i = 0; i < storage.length; i++) {
            var key = storage.key(i);
            if (!key || !LOCAL_ALLOW.test(key) || SECRET_KEY.test(key)) continue;
            var value = storage.getItem(key);
            if (typeof value !== 'string' || value.length > 200000) continue;
            out[key] = value;
        }
        return out;
    }

    function selectedCollections(categories) {
        var out = [];
        var seen = {};
        (categories || Object.keys(CATEGORIES)).forEach(function (name) {
            var cat = CATEGORIES[name];
            if (!cat) return;
            cat.collections.forEach(function (collection) {
                if (seen[collection]) return;
                seen[collection] = true;
                out.push(collection);
            });
        });
        return out;
    }

    function exportData(opts) {
        opts = opts || {};
        var db = opts.db;
        var uid = opts.uid;
        var categories = opts.categories;
        var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () { };
        if (!db || !uid) return Promise.reject(new Error('Sign in to export your data.'));

        var result = {
            format: 'rekindle-export',
            version: 1,
            exportedAt: new Date().toISOString(),
            account: {
                uid: uid,
                username: opts.username || ''
            },
            categories: categories || Object.keys(CATEGORIES),
            data: {},
            local: readLocalStorage(),
            notes: [
                'Passwords, tokens, API keys, IP addresses and the recovery-code hash are never exported.',
                'Social posts and chat messages live in a separate project and are not included in this version.'
            ]
        };

        var collections = selectedCollections(categories);
        var total = collections.length + 1;
        var done = 0;

        function step() {
            onProgress({ stage: 'Working', done: done, total: total });
        }

        return db.collection('users').doc(uid).get().then(function (doc) {
            result.data.profile = doc.exists ? sanitize(doc.data()) : null;
            done++;
            step();
            return collections.reduce(function (chain, name) {
                return chain.then(function () {
                    return db.collection('users').doc(uid).collection(name).get().then(function (snap) {
                        var docs = [];
                        var truncated = false;
                        snap.forEach(function (item) {
                            if (docs.length >= MAX_DOCS_PER_COLLECTION) { truncated = true; return; }
                            // The recovery record contains a salted hash; never
                            // export it even though the doc key is not "secret".
                            if (name === 'privateSettings' && item.id === 'recovery') return;
                            docs.push({ id: item.id, data: sanitize(item.data()) });
                        });
                        result.data[name] = docs;
                        if (truncated) result.data[name + '__truncated'] = true;
                        done++;
                        step();
                    }).catch(function (error) {
                        result.data[name] = { error: (error && error.code) || 'read-failed' };
                        done++;
                        step();
                    });
                });
            }, Promise.resolve());
        }).then(function () {
            var json = JSON.stringify(result, null, 2);
            if (json.length > MAX_BYTES) {
                var tooBig = new Error('That export is larger than 8 MB. Choose fewer categories.');
                tooBig.code = 'export-too-large';
                throw tooBig;
            }
            onProgress({ stage: 'Done', done: total, total: total });
            return { json: json, filename: 'rekindle-data-' + new Date().toISOString().slice(0, 10) + '.json' };
        });
    }

    function timestampMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value;
        if (typeof value.toMillis === 'function') {
            try { return value.toMillis(); } catch (e) { return 0; }
        }
        if (typeof value.toDate === 'function') {
            try { return value.toDate().getTime(); } catch (e) { return 0; }
        }
        if (value instanceof Date) return value.getTime();
        return 0;
    }

    function nextExportAt(lastExportAt) {
        var last = timestampMs(lastExportAt);
        return last ? last + WEEK_MS : 0;
    }

    /**
     * Server-enforced weekly claim. Firestore rules allow the update only when
     * the stored lastExportAt is at least seven days old and the new value is
     * request.time; deletes are denied. Returns a rejected promise with
     * code "weekly-export-limit" and `nextAt` when the slot is still in use.
     */
    function claimExport(db, uid) {
        if (!db || !uid) return Promise.reject(new Error('Sign in to export your data.'));
        if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.firestore.FieldValue) {
            return Promise.reject(new Error('Export limits are not available on this browser.'));
        }
        var ref = db.collection('export_limits').doc(uid);
        return db.runTransaction(function (tx) {
            return tx.get(ref).then(function (doc) {
                var last = doc.exists ? doc.data().lastExportAt : null;
                var next = nextExportAt(last);
                if (next && next > Date.now()) {
                    var error = new Error('You can export your data once a week.');
                    error.code = 'weekly-export-limit';
                    error.nextAt = next;
                    throw error;
                }
                tx.set(ref, {
                    lastExportAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });
        });
    }

    function downloadJSON(json, filename) {
        var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename || 'rekindle-data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    window.RekindleDataExport = {
        CATEGORIES: CATEGORIES,
        exportData: exportData,
        claimExport: claimExport,
        nextExportAt: nextExportAt,
        downloadJSON: downloadJSON,
        sanitize: sanitize,
        readLocalStorage: readLocalStorage,
        selectedCollections: selectedCollections
    };
})();
