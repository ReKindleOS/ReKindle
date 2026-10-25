/**
 * Daily social-content retention job (`cleanupSocial`).
 *
 * Deletes expired content owned by the SOCIAL project (rekindle-socials) plus
 * the primary-project moderator action log. Every task is independent and
 * idempotent: a failure in one collection is logged and the rest still run.
 *
 * Efficiency notes (see docs/agent/social-cleanup.md):
 *  - RTDB candidate scans page `shallow=true` key listings and decode the
 *    Firebase push-ID timestamp to decide age. RTDB rejects orderBy/endAt on
 *    shallow GETs, and downloading every message body would be far more
 *    expensive than keys. The latest 50 chat messages use one limitToLast read
 *    so a dormant room keeps a visible tail.
 *  - Chat deletes are one multi-path update per batch: message + art_index +
 *    every translations_by_lang entry.
 *  - Firestore deletes use batched deletes for comments and recursiveDelete
 *    for topics/posts (no per-comment document reads).
 *  - The job stops at a time budget before the 540 s function timeout, so a
 *    large backlog is caught up over multiple days (oldest first).
 */

const {
    TRANSLATION_LANGS,
    isSafeRtdbKey,
    isQuotaError,
    cutoffMs,
    pushIdTimestamp,
    buildChatDeletePaths,
    shouldDeleteReport,
    toMillis,
    mapWithConcurrency
} = require('./cleanup-lib');

const SOCIAL_DB_URL = 'https://rekindle-socials-default-rtdb.firebaseio.com';
const PRIMARY_DB_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com';

const CLEANUP_CONFIG = {
    // Retention (days). Keep in sync with docs/agent/social-cleanup.md.
    chatRetentionDays: 30,
    keepLatestChatMessages: 50,
    topicRetentionDays: 90,
    neighbourhoodRetentionDays: 90,
    reportRetentionDays: 90,
    automodRetentionDays: 30,
    modActionsRetentionDays: 365,

    // Batch sizes.
    chatBatchSize: 200,
    firestorePageSize: 200,
    deleteBatchSize: 400,
    keyPageSize: 1000,

    // Per-run caps; the time budget is the hard stop. The social Firestore
    // project stays on the free tier (20k writes/day), so the Firestore caps
    // are deliberately sized to leave headroom for post comments and
    // pollVotes. The daily 04:00 Australia/Sydney run lands after the
    // midnight-Pacific quota reset.
    //
    // Chat is RTDB, not Firestore: deletes there consume no Firestore write
    // quota, so the chat cap is only bounded by the 8-minute budget. The room
    // accumulated ~1.07M message keys (29 MB shallow listing), which at the old
    // 5k/run would take ~7 months to prune. 25k/run clears it in ~6 weeks and
    // shrinks RTDB storage (Spark limit: 1 GiB), which is what the daily full
    // scan and any bare-node read have to page through.
    maxTopicsPerRun: 500,
    maxChatMessagesPerRun: 25000,
    maxCommentDeletesPerRun: 4000,
    maxPostDeletesPerRun: 100,
    maxReportDeletesPerRun: 5000,
    maxAutomodDeletesPerRun: 5000,
    maxModActionDeletesPerRun: 5000,
    timeBudgetMs: 8 * 60 * 1000
};

const RETENTION_KEYS = [
    'chatRetentionDays',
    'topicRetentionDays',
    'neighbourhoodRetentionDays',
    'reportRetentionDays',
    'automodRetentionDays',
    'modActionsRetentionDays'
];

const POSITIVE_INT_KEYS = [
    'chatBatchSize',
    'firestorePageSize',
    'deleteBatchSize',
    'keyPageSize',
    'maxTopicsPerRun',
    'maxChatMessagesPerRun',
    'maxCommentDeletesPerRun',
    'maxPostDeletesPerRun',
    'maxReportDeletesPerRun',
    'maxAutomodDeletesPerRun',
    'maxModActionDeletesPerRun',
    'timeBudgetMs'
];

function validateConfig(config, nowMs) {
    if (!Number.isFinite(nowMs)) {
        throw new Error('social-cleanup: now must be a finite timestamp');
    }
    for (const key of RETENTION_KEYS) {
        if (!Number.isInteger(config[key]) || config[key] < 1) {
            throw new Error(`social-cleanup: ${key} must be an integer >= 1`);
        }
    }
    if (!Number.isInteger(config.keepLatestChatMessages) || config.keepLatestChatMessages < 0) {
        throw new Error('social-cleanup: keepLatestChatMessages must be an integer >= 0');
    }
    for (const key of POSITIVE_INT_KEYS) {
        if (!Number.isInteger(config[key]) || config[key] < 1) {
            throw new Error(`social-cleanup: ${key} must be an integer >= 1`);
        }
    }
}

function databaseFor(app) {
    if (!app) return null;
    try {
        return app.database();
    } catch (e) {
        return null;
    }
}

function dbUrlFor(app, fallback) {
    const url = app && app.options && app.options.databaseURL;
    if (typeof url === 'string' && url) return url.replace(/\/+$/, '');
    return fallback;
}

async function runSocialCleanup(options) {
    const opts = options || {};
    const socialApp = opts.socialApp;
    const primaryApp = opts.primaryApp || null;
    const logger = opts.logger || console;
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const config = Object.assign({}, CLEANUP_CONFIG, opts.config || {});
    const dryRun = opts.dryRun === true || process.env.SOCIAL_CLEANUP_DRY_RUN === '1';

    if (!socialApp) {
        throw new Error('social-cleanup: socialApp is required');
    }
    validateConfig(config, now);

    const socialDb = socialApp.firestore();
    const socialRtdb = databaseFor(socialApp);
    const primaryRtdb = databaseFor(primaryApp);
    const socialDbUrl = dbUrlFor(socialApp, SOCIAL_DB_URL);
    const primaryDbUrl = dbUrlFor(primaryApp, PRIMARY_DB_URL);

    const startedAt = Date.now();
    const deadline = startedAt + config.timeBudgetMs;
    const tokens = Object.create(null);

    const summary = {
        dryRun,
        startedAt: new Date(now).toISOString(),
        cutoffs: {
            chat: new Date(cutoffMs(now, config.chatRetentionDays)).toISOString(),
            topics: new Date(cutoffMs(now, config.topicRetentionDays)).toISOString(),
            neighbourhood: new Date(cutoffMs(now, config.neighbourhoodRetentionDays)).toISOString(),
            reports: new Date(cutoffMs(now, config.reportRetentionDays)).toISOString(),
            automod: new Date(cutoffMs(now, config.automodRetentionDays)).toISOString(),
            modActions: new Date(cutoffMs(now, config.modActionsRetentionDays)).toISOString()
        },
        tasks: {},
        errors: []
    };

    function info(message, payload) {
        if (typeof logger.info === 'function') logger.info(message, payload);
        else if (typeof logger.log === 'function') logger.log(message, payload);
    }

    function warn(message, payload) {
        if (typeof logger.warn === 'function') logger.warn(message, payload);
        else if (typeof logger.log === 'function') logger.log(message, payload);
    }

    async function getToken(kind) {
        if (tokens[kind]) return tokens[kind];
        const getter = opts.accessTokens && opts.accessTokens[kind];
        if (typeof getter !== 'function') {
            throw new Error(`social-cleanup: no ${kind} access-token getter configured`);
        }
        const token = await getter();
        if (typeof token !== 'string' || !token) {
            throw new Error(`social-cleanup: empty ${kind} access token`);
        }
        tokens[kind] = token;
        return token;
    }

    async function rtdbFetch(dbUrl, path, params, token) {
        const search = new URLSearchParams(params || {});
        search.set('access_token', token);
        const url = `${dbUrl}/${path}.json?${search.toString()}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
            throw new Error(`RTDB query failed (${response.status})`);
        }
        return response.json();
    }

    /**
     * Page a node's keys with a shallow GET. RTDB rejects orderBy/endAt/startAt
     * on shallow GETs but supports limitToFirst + startAfter. The server returns
     * keys in lexicographic order; the JSON object order is not guaranteed, so
     * sort each page and advance from the greatest key.
     */
    async function forEachKeyPage(dbUrl, path, token, handler) {
        let after = null;
        for (;;) {
            if (Date.now() >= deadline) return;

            const params = {
                shallow: 'true',
                limitToFirst: String(config.keyPageSize)
            };
            if (after) params.startAfter = after;

            const data = await rtdbFetch(dbUrl, path, params, token);
            const keys = data && typeof data === 'object' ? Object.keys(data) : [];
            if (keys.length === 0) return;

            keys.sort();
            const fresh = after
                ? keys.filter(function (key) { return key > after; })
                : keys;
            if (fresh.length === 0) return;

            const outcome = await handler(fresh);
            if (outcome && outcome.stop) return;

            after = fresh[fresh.length - 1];
        }
    }

    async function shallowKeys(dbUrl, path, token) {
        const data = await rtdbFetch(dbUrl, path, { shallow: 'true' }, token);
        if (!data || typeof data !== 'object') return [];
        return Object.keys(data).filter(isSafeRtdbKey);
    }

    async function latestMessageKeys(token) {
        if (config.keepLatestChatMessages <= 0) return [];

        // The only non-shallow chat read: downloads the latest N messages
        // (including any art payload) but never the whole room.
        const data = await rtdbFetch(socialDbUrl, 'kindlechat/messages', {
            orderBy: '"timestamp"',
            limitToLast: String(config.keepLatestChatMessages)
        }, token);
        if (!data || typeof data !== 'object') return [];
        return Object.keys(data).filter(isSafeRtdbKey);
    }

    async function rtdbMultiPathDelete(db, updates) {
        if (!db) throw new Error('social-cleanup: RTDB is unavailable');
        if (!updates || Object.keys(updates).length === 0) return;
        await db.ref().update(updates);
    }

    async function translationLangs(token) {
        try {
            const live = await shallowKeys(socialDbUrl, 'kindlechat/translations_by_lang', token);
            if (live.length) return live;
        } catch (e) {
            warn('social-cleanup: could not read live translation languages; using fallback', {
                message: e.message
            });
        }
        return TRANSLATION_LANGS.slice();
    }

    async function cleanupChat() {
        if (!dryRun && !socialRtdb) throw new Error('social-cleanup: social RTDB is unavailable');
        const token = await getToken('social');
        const chatCutoff = cutoffMs(now, config.chatRetentionDays);
        const keep = new Set(await latestMessageKeys(token));
        const langs = await translationLangs(token);

        let deleted = 0;
        let batches = 0;
        let scanned = 0;
        let invalidKeys = 0;
        let truncated = false;

        await forEachKeyPage(socialDbUrl, 'kindlechat/messages', token, async function (keys) {
            const deletable = [];
            let reachedCutoff = false;

            for (const key of keys) {
                if (!isSafeRtdbKey(key)) {
                    invalidKeys++;
                    continue;
                }
                const createdAt = pushIdTimestamp(key);
                if (!createdAt) {
                    invalidKeys++;
                    continue;
                }
                if (createdAt >= chatCutoff) {
                    // Keys are chronological; everything after this is newer.
                    reachedCutoff = true;
                    break;
                }
                scanned++;
                if (!keep.has(key)) deletable.push(key);
            }

            for (let offset = 0; offset < deletable.length;) {
                if (deleted >= config.maxChatMessagesPerRun || Date.now() >= deadline) {
                    truncated = true;
                    return { stop: true };
                }
                const size = Math.min(
                    config.chatBatchSize,
                    config.maxChatMessagesPerRun - deleted,
                    deletable.length - offset
                );
                if (size <= 0) {
                    truncated = true;
                    return { stop: true };
                }
                const batch = deletable.slice(offset, offset + size);
                if (!dryRun) {
                    await rtdbMultiPathDelete(socialRtdb, buildChatDeletePaths(batch, langs));
                }
                deleted += size;
                batches++;
                offset += size;
            }

            if (reachedCutoff) return { stop: true };
            if (deleted >= config.maxChatMessagesPerRun) {
                truncated = true;
                return { stop: true };
            }
            return {};
        });

        return {
            deleted,
            batches,
            scanned,
            invalidKeys,
            languages: langs.length,
            truncated: truncated || deleted >= config.maxChatMessagesPerRun
        };
    }

    async function cleanupTopics() {
        const commentCutoff = new Date(cutoffMs(now, config.topicRetentionDays));
        const topicDocs = [];
        let last = null;

        while (topicDocs.length < config.maxTopicsPerRun && Date.now() < deadline) {
            const pageLimit = Math.min(config.firestorePageSize, config.maxTopicsPerRun - topicDocs.length);
            let query = socialDb.collection('topics')
                .where('timestamp', '<', commentCutoff)
                .orderBy('timestamp', 'asc')
                .limit(pageLimit)
                .select('timestamp', 'lastActive', 'commentCount');
            if (last) query = query.startAfter(last);

            const page = await query.get();
            if (page.empty) break;
            topicDocs.push.apply(topicDocs, page.docs);
            last = page.docs[page.docs.length - 1];
            if (page.size < pageLimit) break;
        }

        let commentsDeleted = 0;
        let topicsDeleted = 0;
        let topicsRepaired = 0;
        let topicErrors = 0;
        let quotaExceeded = false;
        let truncated = topicDocs.length >= config.maxTopicsPerRun;

        async function commentCountFor(topicRef) {
            const countSnap = await topicRef.collection('comments').count().get();
            return countSnap.data().count;
        }

        async function processTopic(topicDoc, commentBudget) {
            const data = topicDoc.data() || {};
            let deletedForTopic = 0;

            while (deletedForTopic < commentBudget && Date.now() < deadline) {
                const batchLimit = Math.min(config.deleteBatchSize, commentBudget - deletedForTopic);
                const snapshot = await topicDoc.ref.collection('comments')
                    .where('timestamp', '<', commentCutoff)
                    .orderBy('timestamp', 'asc')
                    .limit(batchLimit)
                    .select('timestamp')
                    .get();
                if (snapshot.empty) break;

                if (!dryRun) {
                    const batch = socialDb.batch();
                    snapshot.docs.forEach(function (doc) { batch.delete(doc.ref); });
                    await batch.commit();
                }
                deletedForTopic += snapshot.size;
                // Dry-run counts one batch per topic; no writes, no loops.
                if (dryRun || snapshot.size < config.deleteBatchSize) break;
            }

            if (dryRun) {
                return { commentsDeleted: deletedForTopic, topicDeleted: false, repaired: false };
            }

            const storedCount = Number(data.commentCount);

            if (deletedForTopic > 0) {
                let remaining = await commentCountFor(topicDoc.ref);

                if (remaining === 0) {
                    // Re-check immediately before the destructive step so a
                    // comment posted during the cleanup keeps the topic alive.
                    remaining = await commentCountFor(topicDoc.ref);
                    if (remaining === 0) {
                        await socialDb.recursiveDelete(topicDoc.ref);
                        return { commentsDeleted: deletedForTopic, topicDeleted: true, repaired: false };
                    }
                }

                const newestSnap = await topicDoc.ref.collection('comments')
                    .orderBy('timestamp', 'desc')
                    .limit(1)
                    .select('timestamp')
                    .get();
                const newest = newestSnap.empty ? null : newestSnap.docs[0].data().timestamp;

                await socialDb.runTransaction(async function (tx) {
                    const currentSnap = await tx.get(topicDoc.ref);
                    if (!currentSnap.exists) return;

                    const currentCount = Number(currentSnap.get('commentCount'));
                    const nextCount = Number.isFinite(currentCount) && currentCount >= deletedForTopic
                        ? Math.max(0, currentCount - deletedForTopic)
                        : remaining;

                    const updates = {};
                    if (!Number.isFinite(currentCount) || nextCount !== currentCount) {
                        updates.commentCount = nextCount;
                    }

                    const currentLastActive = toMillis(currentSnap.get('lastActive'));
                    const newestMs = toMillis(newest);
                    if (newestMs > currentLastActive) {
                        updates.lastActive = new Date(newestMs);
                    }

                    if (Object.keys(updates).length > 0) {
                        tx.update(topicDoc.ref, updates);
                    }
                });

                return { commentsDeleted: deletedForTopic, topicDeleted: false, repaired: true };
            }

            // Old topic with no old comments: remove it if it is genuinely
            // empty, otherwise repair a missing/drifted counter.
            if (!Number.isFinite(storedCount) || storedCount <= 0) {
                let remaining = await commentCountFor(topicDoc.ref);
                if (remaining === 0) {
                    remaining = await commentCountFor(topicDoc.ref);
                    if (remaining === 0) {
                        await socialDb.recursiveDelete(topicDoc.ref);
                        return { commentsDeleted: 0, topicDeleted: true, repaired: false };
                    }
                }
                if (!Number.isFinite(storedCount) || storedCount !== remaining) {
                    await topicDoc.ref.update({ commentCount: remaining });
                    return { commentsDeleted: 0, topicDeleted: false, repaired: true };
                }
            }

            return { commentsDeleted: 0, topicDeleted: false, repaired: false };
        }

        for (const topicDoc of topicDocs) {
            if (Date.now() >= deadline) {
                truncated = true;
                break;
            }
            if (commentsDeleted >= config.maxCommentDeletesPerRun) {
                truncated = true;
                break;
            }

            try {
                const result = await processTopic(topicDoc, config.maxCommentDeletesPerRun - commentsDeleted);
                commentsDeleted += result.commentsDeleted;
                if (result.topicDeleted) topicsDeleted++;
                if (result.repaired) topicsRepaired++;
                if (Date.now() >= deadline) {
                    truncated = true;
                    break;
                }
            } catch (e) {
                topicErrors++;
                const message = e && e.message ? e.message : String(e);
                warn(`social-cleanup: topic task skipped: ${message}`, {
                    path: topicDoc.ref.path
                });
                if (isQuotaError(e)) {
                    quotaExceeded = true;
                    truncated = true;
                    break;
                }
            }
        }

        return {
            topicsScanned: topicDocs.length,
            commentsDeleted,
            topicsDeleted,
            topicsRepaired,
            topicErrors,
            quotaExceeded,
            truncated: truncated || commentsDeleted >= config.maxCommentDeletesPerRun
        };
    }

    async function cleanupNeighbourhood() {
        const cutoff = new Date(cutoffMs(now, config.neighbourhoodRetentionDays));
        const snapshot = await socialDb.collection('neighbourhood_posts')
            .where('timestamp', '<', cutoff)
            .orderBy('timestamp', 'asc')
            .limit(config.maxPostDeletesPerRun)
            .select('timestamp')
            .get();

        const docs = snapshot.docs;
        const truncated = docs.length >= config.maxPostDeletesPerRun;

        if (dryRun) {
            return { postsDeleted: docs.length, errors: 0, truncated };
        }

        let postsDeleted = 0;
        let errors = 0;
        let quotaExceeded = false;
        let timeTruncated = false;

        await mapWithConcurrency(docs, 4, async function (doc) {
            if (quotaExceeded || Date.now() >= deadline) {
                timeTruncated = true;
                return;
            }
            try {
                await socialDb.recursiveDelete(doc.ref);
                postsDeleted++;
            } catch (e) {
                errors++;
                const message = e && e.message ? e.message : String(e);
                warn(`social-cleanup: post delete failed: ${message}`, {
                    path: doc.ref.path
                });
                if (isQuotaError(e)) {
                    quotaExceeded = true;
                    timeTruncated = true;
                }
            }
        });

        return { postsDeleted, errors, quotaExceeded, truncated: truncated || timeTruncated };
    }

    async function cleanupReports() {
        if (!dryRun && !socialRtdb) throw new Error('social-cleanup: social RTDB is unavailable');
        const token = await getToken('social');
        const reportCutoff = cutoffMs(now, config.reportRetentionDays) - 1;

        let deleted = 0;
        let pendingSkipped = 0;
        let batches = 0;

        while (deleted < config.maxReportDeletesPerRun && batches < 10 && Date.now() < deadline) {
            const data = await rtdbFetch(socialDbUrl, 'reports', {
                orderBy: '"createdAt"',
                startAt: '0',
                endAt: String(reportCutoff),
                limitToFirst: '500'
            }, token);

            if (!data || typeof data !== 'object') break;
            const keys = Object.keys(data);
            if (keys.length === 0) break;

            const deletable = keys.filter(function (id) {
                return isSafeRtdbKey(id) && shouldDeleteReport(data[id], now, config.reportRetentionDays);
            });
            pendingSkipped += keys.length - deletable.length;

            // The oldest page is all pending reports: stop rather than re-read
            // it every day. They stay until a moderator resolves them.
            if (deletable.length === 0) break;

            const toDelete = deletable.slice(0, config.maxReportDeletesPerRun - deleted);
            const updates = {};
            toDelete.forEach(function (id) { updates[`reports/${id}`] = null; });
            if (!dryRun) await rtdbMultiPathDelete(socialRtdb, updates);

            deleted += toDelete.length;
            batches++;
            if (dryRun || keys.length < 500 || deleted >= config.maxReportDeletesPerRun) break;
        }

        return {
            deleted,
            pendingSkipped,
            batches,
            truncated: deleted >= config.maxReportDeletesPerRun
        };
    }

    async function cleanupAutomod() {
        if (!dryRun && !socialRtdb) throw new Error('social-cleanup: social RTDB is unavailable');
        const token = await getToken('social');
        const cutoff = cutoffMs(now, config.automodRetentionDays);

        let deleted = 0;
        let batches = 0;
        let invalidKeys = 0;
        let truncated = false;

        await forEachKeyPage(socialDbUrl, 'automod_log', token, async function (keys) {
            const old = [];
            let reachedCutoff = false;

            for (const key of keys) {
                if (!isSafeRtdbKey(key)) {
                    invalidKeys++;
                    continue;
                }
                const createdAt = pushIdTimestamp(key);
                if (!createdAt) {
                    invalidKeys++;
                    continue;
                }
                if (createdAt >= cutoff) {
                    reachedCutoff = true;
                    break;
                }
                old.push(key);
            }

            for (let offset = 0; offset < old.length;) {
                if (deleted >= config.maxAutomodDeletesPerRun || Date.now() >= deadline) {
                    truncated = true;
                    return { stop: true };
                }
                const size = Math.min(
                    500,
                    config.maxAutomodDeletesPerRun - deleted,
                    old.length - offset
                );
                if (size <= 0) {
                    truncated = true;
                    return { stop: true };
                }
                const batch = old.slice(offset, offset + size);
                const updates = {};
                batch.forEach(function (id) { updates[`automod_log/${id}`] = null; });
                if (!dryRun) await rtdbMultiPathDelete(socialRtdb, updates);
                deleted += size;
                batches++;
                offset += size;
            }

            if (reachedCutoff) return { stop: true };
            if (deleted >= config.maxAutomodDeletesPerRun) {
                truncated = true;
                return { stop: true };
            }
            return {};
        });

        return {
            deleted,
            batches,
            invalidKeys,
            truncated: truncated || deleted >= config.maxAutomodDeletesPerRun
        };
    }

    async function cleanupModActions() {
        if (!dryRun && !primaryRtdb) throw new Error('social-cleanup: primary RTDB is unavailable');
        const token = await getToken('primary');
        const cutoff = cutoffMs(now, config.modActionsRetentionDays);

        let deleted = 0;
        let batches = 0;
        let invalidKeys = 0;
        let skipped = 0;
        let truncated = false;

        await forEachKeyPage(primaryDbUrl, 'mod_actions', token, async function (keys) {
            const candidates = [];
            let reachedCutoff = false;

            for (const key of keys) {
                if (!isSafeRtdbKey(key)) {
                    invalidKeys++;
                    continue;
                }
                const createdAt = pushIdTimestamp(key);
                if (!createdAt) {
                    invalidKeys++;
                    continue;
                }
                if (createdAt >= cutoff) {
                    reachedCutoff = true;
                    break;
                }
                candidates.push(key);
            }

            if (candidates.length > 0) {
                // mod_actions keys are often created by the client, so the push
                // time can reflect a skewed device clock. Verify the stored
                // createdAt (a single-field GET, no savedData payload) before
                // deleting. Discord/server-created actions pass immediately.
                const verified = await mapWithConcurrency(candidates, 10, async function (id) {
                    try {
                        const value = await rtdbFetch(primaryDbUrl, `mod_actions/${id}/createdAt`, {}, token);
                        return {
                            id,
                            createdAt: typeof value === 'number' && Number.isFinite(value) ? value : NaN
                        };
                    } catch (e) {
                        return { id, createdAt: NaN };
                    }
                });
                const old = verified
                    .filter(function (entry) { return Number.isFinite(entry.createdAt) && entry.createdAt < cutoff; })
                    .map(function (entry) { return entry.id; });
                skipped += verified.length - old.length;

                for (let offset = 0; offset < old.length;) {
                    if (deleted >= config.maxModActionDeletesPerRun || Date.now() >= deadline) {
                        truncated = true;
                        return { stop: true };
                    }
                    const size = Math.min(
                        500,
                        config.maxModActionDeletesPerRun - deleted,
                        old.length - offset
                    );
                    if (size <= 0) {
                        truncated = true;
                        return { stop: true };
                    }
                    const batch = old.slice(offset, offset + size);
                    const updates = {};
                    batch.forEach(function (id) { updates[`mod_actions/${id}`] = null; });
                    if (!dryRun) await rtdbMultiPathDelete(primaryRtdb, updates);
                    deleted += size;
                    batches++;
                    offset += size;
                }
            }

            if (reachedCutoff) return { stop: true };
            if (deleted >= config.maxModActionDeletesPerRun) {
                truncated = true;
                return { stop: true };
            }
            return {};
        });

        return {
            deleted,
            batches,
            invalidKeys,
            skipped,
            truncated: truncated || deleted >= config.maxModActionDeletesPerRun
        };
    }

    async function runTask(name, fn) {
        if (Date.now() >= deadline) {
            summary.tasks[name] = { skipped: 'time_budget' };
            return;
        }

        const taskStarted = Date.now();
        try {
            const result = await fn();
            summary.tasks[name] = Object.assign({}, result, { elapsedMs: Date.now() - taskStarted });
            info(`social-cleanup: ${name}`, summary.tasks[name]);
        } catch (e) {
            const message = e && e.message ? e.message : String(e);
            summary.tasks[name] = { error: message, elapsedMs: Date.now() - taskStarted };

            // Free-tier Firestore/RTDB quotas are an expected operational
            // limit, not a code failure. Log it and let the next daily run
            // continue instead of returning a scheduler 500.
            if (isQuotaError(e)) {
                summary.tasks[name].quotaExceeded = true;
                warn(`social-cleanup: ${name} quota exceeded: ${message}`);
                return;
            }

            summary.errors.push({ task: name, message });
            if (typeof logger.error === 'function') {
                logger.error(`social-cleanup: ${name} failed: ${message}`, { task: name, error: message });
            } else {
                warn(`social-cleanup: ${name} failed: ${message}`, { task: name, error: message });
            }
        }
    }

    info('social-cleanup: starting', {
        dryRun,
        cutoffs: summary.cutoffs,
        timeBudgetMs: config.timeBudgetMs
    });

    await runTask('chat', cleanupChat);
    await runTask('topics', cleanupTopics);
    await runTask('neighbourhood', cleanupNeighbourhood);
    await runTask('reports', cleanupReports);
    await runTask('automod', cleanupAutomod);
    await runTask('modActions', cleanupModActions);

    summary.elapsedMs = Date.now() - startedAt;
    info('social-cleanup: finished', {
        dryRun,
        elapsedMs: summary.elapsedMs,
        errors: summary.errors.length,
        tasks: summary.tasks
    });

    return summary;
}

module.exports = {
    CLEANUP_CONFIG,
    runSocialCleanup,
    SOCIAL_DB_URL,
    PRIMARY_DB_URL
};
