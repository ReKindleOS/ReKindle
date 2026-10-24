/**
 * Permanent account deletion (`deleteAccount`).
 *
 * Called from settings.html after the user reauthenticates with their
 * password and types their username. The browser never supplies a uid, a path
 * or a list of documents: everything below is derived from `request.auth.uid`
 * and values read server-side.
 *
 * Why a Cloud Function and not client code:
 *   - clients cannot delete KindleChat messages, DM threads, social reports,
 *     moderator-issued timeouts or Storage files (rules deny those writes);
 *   - clients cannot delete a Firebase Auth record;
 *   - a client-side sweep would be interrupted by closing the tab, leaving
 *     personal data behind.
 *
 * Safety properties:
 *   - The Auth record is deleted LAST. If any content step fails or the time
 *     budget runs out, the account still exists and the user can sign in and
 *     retry; every step is idempotent.
 *   - Reauthentication within RECENT_AUTH_MAX_SECONDS is required, so a
 *     borrowed session cannot nuke an account.
 *   - The typed username confirmation is verified server-side.
 *
 * Data inventory and the deliberate exclusions are documented in
 * docs/agent/account-deletion.md. Keep that file in sync with this one.
 */

'use strict';

const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { HttpsError } = require('firebase-functions/v2/https');

const { TRANSLATION_LANGS, isSafeRtdbKey, chunk, buildChatDeletePaths } = require('./cleanup-lib');
const {
    RECENT_AUTH_MAX_SECONDS,
    DELETION_TIME_BUDGET_MS,
    FIRESTORE_BATCH_SIZE,
    CHAT_BATCH_SIZE,
    confirmationMatches,
    isRecentAuth,
    emailHandle,
    pickUsername,
    isValidUid,
    buildPrimaryUserDeletePaths,
    buildSocialUserDeletePaths,
    shouldDeleteReportForUser,
    emptySummary
} = require('./account-deletion-lib');
const { COLLECTIONS } = require('./score-config');

const LEADERBOARD_COLLECTIONS = Object.keys(COLLECTIONS);
const GAME_IDS = Object.keys(COLLECTIONS).map(function (name) { return COLLECTIONS[name].game; })
    .filter(function (game, index, all) { return all.indexOf(game) === index; });

// Nodes read by the moderation console / social apps that are keyed by uid.
// `banned_ips` and `mod_actions` are deliberately NOT here (see docs).
const SOCIAL_AUTH_NOT_FOUND = 'auth/user-not-found';

function assertWithinBudget(deadline) {
    if (Date.now() < deadline) return;
    throw new HttpsError(
        'deadline-exceeded',
        'Deletion took longer than expected and did not finish. Your account is still active. Please try again; it will resume where it stopped.'
    );
}

function toNumber(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return 0;
}

/**
 * Best-effort Stripe cleanup. `STRIPE_KEY` is optional in
 * firebase-functions/.env: when it is absent we log and continue (deleting the
 * Firebase account must not depend on a billing secret), so the UI warns users
 * with a recurring plan to cancel it first.
 */
async function cancelStripeSubscription(stripeCustomerId, uid) {
    const key = process.env.STRIPE_KEY;
    if (!key || !stripeCustomerId) {
        if (stripeCustomerId) {
            logger.warn('deleteAccount: STRIPE_KEY not configured; subscription for uid not cancelled automatically', { uid: uid });
        }
        return { cancelled: 0, customerDeleted: false };
    }

    const auth = 'Bearer ' + key;
    async function stripe(method, path) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 8000);
        try {
            const res = await fetch('https://api.stripe.com/v1/' + path, {
                method: method,
                headers: { Authorization: auth },
                signal: controller.signal
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error('Stripe ' + res.status + ': ' + text.slice(0, 300));
            }
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    let cancelled = 0;
    try {
        const list = await stripe('GET', 'subscriptions?status=all&limit=100&customer=' + encodeURIComponent(stripeCustomerId));
        const subscriptions = Array.isArray(list.data) ? list.data : [];
        for (let i = 0; i < subscriptions.length; i++) {
            const sub = subscriptions[i];
            if (!sub || !sub.id) continue;
            if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue;
            await stripe('DELETE', 'subscriptions/' + encodeURIComponent(sub.id));
            cancelled++;
        }
    } catch (e) {
        logger.warn('deleteAccount: Stripe subscription cancellation failed', { uid: uid, message: e.message });
    }

    let customerDeleted = false;
    try {
        await stripe('DELETE', 'customers/' + encodeURIComponent(stripeCustomerId));
        customerDeleted = true;
    } catch (e) {
        // A customer with an active subscription cannot always be deleted; the
        // cancellation above is what matters.
        logger.warn('deleteAccount: Stripe customer deletion failed', { uid: uid, message: e.message });
    }

    return { cancelled: cancelled, customerDeleted: customerDeleted };
}

/* -------------------------------------------------------------------------- */
/* Firestore                                                                   */
/* -------------------------------------------------------------------------- */

async function deleteFirestoreDocs(db, docs, deadline) {
    const groups = chunk(docs, FIRESTORE_BATCH_SIZE);
    let deleted = 0;
    for (let i = 0; i < groups.length; i++) {
        assertWithinBudget(deadline);
        const batch = db.batch();
        groups[i].forEach(function (doc) { batch.delete(doc.ref); });
        await batch.commit();
        deleted += groups[i].length;
    }
    return deleted;
}

/**
 * Delete every document matching a query in pages. Used for unbounded sets
 * (score_audit, uploads) so one huge account cannot blow the batch limit.
 *
 * There is deliberately no "give up and continue" path: if the safety cap is
 * reached the function throws BEFORE the Auth record is removed, so a retry
 * can finish the job. Silently leaving rows behind after deleting Auth would
 * make them unrecoverable.
 */
async function deleteQuery(db, query, deadline) {
    const limit = FIRESTORE_BATCH_SIZE;
    let total = 0;
    let pages = 0;
    while (true) {
        assertWithinBudget(deadline);
        const snap = await query.limit(limit).get();
        if (snap.empty) break;
        total += await deleteFirestoreDocs(db, snap.docs, deadline);
        pages++;
        if (snap.size < limit) break;
        if (pages >= 500) {
            throw new HttpsError(
                'internal',
                'This account has too many records to delete in one run. Please try again; deletion will resume where it stopped.'
            );
        }
    }
    return total;
}

async function repairTopicCounters(topicRef, deletedCount, socialDb) {
    // Never delete the topic here. If the departing user's comment happened to
    // be the last one, the topic belongs to someone else and must stay (with a
    // zero comment count). Deleting whole topics is only done for topics the
    // deleted user authored.
    //
    // The count is decremented by the number we removed rather than replaced
    // with a fresh aggregation, so a comment posted concurrently is not lost
    // from commentCount. The aggregation is only a fallback for malformed
    // legacy counters.
    const countSnap = await topicRef.collection('comments').count().get();
    const remaining = countSnap.data().count;

    const newestSnap = await topicRef.collection('comments')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .select('timestamp')
        .get();
    const newest = newestSnap.empty ? 0 : toNumber(newestSnap.docs[0].get('timestamp'));

    await socialDb.runTransaction(async function (tx) {
        const currentSnap = await tx.get(topicRef);
        if (!currentSnap.exists) return;

        const currentCount = Number(currentSnap.get('commentCount'));
        const nextCount = (Number.isFinite(currentCount) && currentCount >= deletedCount)
            ? Math.max(0, currentCount - deletedCount)
            : remaining;
        const updates = {};
        if (!Number.isFinite(currentCount) || nextCount !== currentCount) {
            updates.commentCount = nextCount;
        }
        const currentLastActive = toNumber(currentSnap.get('lastActive'));
        if (newest > 0 && newest !== currentLastActive) {
            updates.lastActive = new Date(newest);
        }
        if (Object.keys(updates).length > 0) tx.update(topicRef, updates);
    });
}

async function repairPostCommentCount(postRef, deletedCount, socialDb) {
    // Same concurrency-safe decrement as repairTopicCounters().
    const countSnap = await postRef.collection('comments').count().get();
    const remaining = countSnap.data().count;
    await socialDb.runTransaction(async function (tx) {
        const currentSnap = await tx.get(postRef);
        if (!currentSnap.exists) return;
        const currentCount = Number(currentSnap.get('commentCount'));
        const nextCount = (Number.isFinite(currentCount) && currentCount >= deletedCount)
            ? Math.max(0, currentCount - deletedCount)
            : remaining;
        if (!Number.isFinite(currentCount) || nextCount !== currentCount) {
            tx.update(postRef, { commentCount: nextCount });
        }
    });
}

function isMissingIndexError(e) {
    const code = Number(e && e.code);
    const text = String((e && e.message) || '');
    return /requires an index|no matching index|index[^.]*not found/i.test(text) || (code === 9 && /index/i.test(text));
}

/**
 * Group comments fetched by a collection-group query by their parent topic or
 * post, delete them in batches, and repair each parent's denormalised counter
 * once. This replaces one comments query per topic/post with a single indexed
 * query when the collection-group index is deployed.
 */
async function deleteCommentsGrouped(socialDb, commentDocs, summary, deadline, counterKey, repairFn) {
    const groups = new Map();
    for (let i = 0; i < commentDocs.length; i++) {
        const doc = commentDocs[i];
        const parent = doc.ref.parent && doc.ref.parent.parent;
        if (!parent) continue;
        if (!groups.has(parent.path)) groups.set(parent.path, { ref: parent, docs: [] });
        groups.get(parent.path).docs.push(doc);
    }

    for (const group of groups.values()) {
        assertWithinBudget(deadline);
        const deleted = await deleteFirestoreDocs(socialDb, group.docs, deadline);
        summary[counterKey] += deleted;
        await repairFn(group.ref, deleted, socialDb);
    }
}

async function cleanupSocialFirestore(ctx) {
    const { uid, socialDb, summary, deadline } = ctx;

    // Topics authored by the user: the whole subtree (comments + pollVotes).
    const topicsSnap = await socialDb.collection('topics').where('authorId', '==', uid).get();
    for (let i = 0; i < topicsSnap.docs.length; i++) {
        assertWithinBudget(deadline);
        await socialDb.recursiveDelete(topicsSnap.docs[i].ref);
        summary.topics++;
    }

    // Select only the field we need so a large topic list does not download
    // full bodies. This list is still needed for pollVotes/{uid}, which has no
    // per-user index.
    const allTopicsSnap = await socialDb.collection('topics').select('authorId').get();
    const otherTopics = allTopicsSnap.docs.filter(function (doc) {
        return doc.get('authorId') !== uid;
    });

    // Comments the user left on other people's topics. Firestore's automatic
    // single-field collection-group index serves this as one query; if the
    // query is rejected for a missing index, fall back to one comments query
    // per topic (correct, just slower).
    let usedTopicCollectionGroup = false;
    try {
        const commentsSnap = await socialDb.collectionGroup('comments')
            .where('authorId', '==', uid).get();
        usedTopicCollectionGroup = true;
        if (!commentsSnap.empty) {
            await deleteCommentsGrouped(
                socialDb, commentsSnap.docs, summary, deadline, 'topicComments', repairTopicCounters
            );
        }
    } catch (e) {
        if (!isMissingIndexError(e)) throw e;
        logger.warn('deleteAccount: comments.authorId collection-group index missing; using per-topic scan', { uid: uid });
    }

    for (let i = 0; i < otherTopics.length; i++) {
        const topicDoc = otherTopics[i];
        assertWithinBudget(deadline);

        // pollVotes/{uid} is per-topic state, so deleting the topics the user
        // authored does not cover their votes on everyone else's polls.
        await topicDoc.ref.collection('pollVotes').doc(uid).delete();

        if (usedTopicCollectionGroup) continue;

        const commentsSnap = await topicDoc.ref.collection('comments')
            .where('authorId', '==', uid).get();
        if (commentsSnap.empty) continue;

        const deleted = await deleteFirestoreDocs(socialDb, commentsSnap.docs, deadline);
        summary.topicComments += deleted;
        await repairTopicCounters(topicDoc.ref, deleted, socialDb);
    }

    // Neighbourhood posts authored by the user.
    const postsSnap = await socialDb.collection('neighbourhood_posts').where('uid', '==', uid).get();
    for (let i = 0; i < postsSnap.docs.length; i++) {
        assertWithinBudget(deadline);
        await socialDb.recursiveDelete(postsSnap.docs[i].ref);
        summary.neighbourhoodPosts++;
    }

    // Comments the user left on other people's posts.
    let usedPostCollectionGroup = false;
    try {
        const commentsSnap = await socialDb.collectionGroup('comments')
            .where('uid', '==', uid).get();
        usedPostCollectionGroup = true;
        if (!commentsSnap.empty) {
            await deleteCommentsGrouped(
                socialDb, commentsSnap.docs, summary, deadline, 'neighbourhoodComments', repairPostCommentCount
            );
        }
    } catch (e) {
        if (!isMissingIndexError(e)) throw e;
        logger.warn('deleteAccount: comments.uid collection-group index missing; using per-post scan', { uid: uid });
    }

    if (!usedPostCollectionGroup) {
        const allPostsSnap = await socialDb.collection('neighbourhood_posts').select('uid').get();
        for (let i = 0; i < allPostsSnap.docs.length; i++) {
            const postDoc = allPostsSnap.docs[i];
            if (postDoc.get('uid') === uid) continue;
            assertWithinBudget(deadline);

            const commentsSnap = await postDoc.ref.collection('comments')
                .where('uid', '==', uid).get();
            if (commentsSnap.empty) continue;

            const deleted = await deleteFirestoreDocs(socialDb, commentsSnap.docs, deadline);
            summary.neighbourhoodComments += deleted;
            await repairPostCommentCount(postDoc.ref, deleted, socialDb);
        }
    }
}

async function cleanupPrimaryFirestore(ctx) {
    const { uid, db, email, summary, deadline } = ctx;

    // users/{uid} and every subcollection (notes, tasks, library, pro_data,
    // settings, reading logs, …). recursiveDelete handles subcollections even
    // when the parent document is already missing.
    await db.recursiveDelete(db.collection('users').doc(uid));
    summary.firestoreDocuments++;

    // Leaderboards + game run tokens are keyed by uid across many collections.
    for (let i = 0; i < LEADERBOARD_COLLECTIONS.length; i++) {
        assertWithinBudget(deadline);
        await db.collection(LEADERBOARD_COLLECTIONS[i]).doc(uid).delete();
        summary.firestoreDocuments++;
    }
    for (let i = 0; i < GAME_IDS.length; i++) {
        assertWithinBudget(deadline);
        await db.collection('game_runs').doc(uid + '_' + GAME_IDS[i]).delete();
        summary.gameRuns++;
    }

    // Audit rows and uploads are queried because their document ids are not
    // the uid.
    summary.firestoreDocuments += await deleteQuery(
        db, db.collection('score_audit').where('uid', '==', uid), deadline
    );
    summary.firestoreDocuments += await deleteQuery(
        db, db.collection('interactive_uploads').where('uploaderUid', '==', uid), deadline
    );
    summary.firestoreDocuments += await deleteQuery(
        db, db.collection('sheet_music_uploads').where('uploaderUid', '==', uid), deadline
    );
    summary.firestoreDocuments += await deleteQuery(
        db, db.collection('word_games').where('p1_uid', '==', uid), deadline
    );
    summary.firestoreDocuments += await deleteQuery(
        db, db.collection('word_games').where('p2_uid', '==', uid), deadline
    );

    // Legacy KindleChat Firestore rooms and the words.html game-link notices
    // written into rooms/general/messages. KindleChat itself moved to the
    // social RTDB, but old DM rooms and game notices still carry uid-keyed
    // messages, and admin/nuke_user.js has always swept them.
    const roomsSnap = await db.collection('rooms').get();
    for (let i = 0; i < roomsSnap.docs.length; i++) {
        assertWithinBudget(deadline);
        const roomDoc = roomsSnap.docs[i];
        const byUid = await roomDoc.ref.collection('messages').where('uid', '==', uid).get();
        if (!byUid.empty) {
            summary.firestoreDocuments += await deleteFirestoreDocs(db, byUid.docs, deadline);
        }
        if (ctx.handle) {
            const byHandle = await roomDoc.ref.collection('messages').where('user', '==', ctx.handle).get();
            if (!byHandle.empty) {
                summary.firestoreDocuments += await deleteFirestoreDocs(db, byHandle.docs, deadline);
            }

            // Remove the account's email handle from the room participant list
            // (legacy DMs are keyed by handle, not uid). If nobody is left, the
            // room has no owner and is removed with its messages.
            const participants = roomDoc.get('participants');
            if (Array.isArray(participants) && participants.indexOf(ctx.handle) !== -1) {
                const remaining = participants.filter(function (p) { return p !== ctx.handle; });
                if (remaining.length === 0) {
                    await db.recursiveDelete(roomDoc.ref);
                } else {
                    await roomDoc.ref.update({ participants: remaining });
                }
            }
        }
    }

    // Pro entitlements keyed by email / uid in config docs. `email` comes from
    // the Auth token because users/{uid} is deleted above. A failure here is
    // fatal (before Auth deletion) so a deleted Pro/mod account cannot keep a
    // live entitlement.
    if (email) {
        await db.collection('config').doc('supporters')
            .set({ [email]: admin.firestore.FieldValue.delete() }, { merge: true });
    }
    await db.collection('config').doc('moderators')
        .set({ [uid]: admin.firestore.FieldValue.delete() }, { merge: true });
}

/* -------------------------------------------------------------------------- */
/* Realtime Database                                                           */
/* -------------------------------------------------------------------------- */

async function deleteRealtimeMessages(rtdb, ids, summary, deadline) {
    const groups = chunk(ids, CHAT_BATCH_SIZE);
    for (let i = 0; i < groups.length; i++) {
        assertWithinBudget(deadline);
        const group = groups[i];
        const updates = buildChatDeletePaths(group, TRANSLATION_LANGS);
        if (Object.keys(updates).length === 0) continue;
        await rtdb.ref().update(updates);
        summary.chatMessages += group.length;
        summary.chatTranslations += group.length * TRANSLATION_LANGS.length;
    }
}

async function cleanupSocialRtdb(ctx) {
    const { uid, socialRtdb, summary, deadline } = ctx;

    // KindleChat messages (both `uid` and legacy `user` handle are queried).
    const messageIds = {};
    try {
        const byUid = await socialRtdb.ref('kindlechat/messages')
            .orderByChild('uid').equalTo(uid).once('value');
        byUid.forEach(function (child) { messageIds[child.key] = true; });
        const handle = ctx.handle;
        if (handle && isSafeRtdbKey(handle)) {
            const byHandle = await socialRtdb.ref('kindlechat/messages')
                .orderByChild('user').equalTo(handle).once('value');
            byHandle.forEach(function (child) { messageIds[child.key] = true; });
        }
    } catch (e) {
        // Any query failure must abort before the Auth record is deleted:
        // silently skipping personal data would make it unrecoverable.
        throw new Error('KindleChat message query failed: ' + e.message);
    }
    const ids = Object.keys(messageIds);
    await deleteRealtimeMessages(socialRtdb, ids, summary, deadline);

    // Art gallery index. buildChatDeletePaths already removes the entry that
    // matches each message id; this query catches orphaned art entries whose
    // message was removed earlier.
    try {
        const artSnap = await socialRtdb.ref('kindlechat/art_index')
            .orderByChild('uid').equalTo(uid).once('value');
        const artUpdates = {};
        let artCount = 0;
        artSnap.forEach(function (child) {
            if (!isSafeRtdbKey(child.key)) return;
            artUpdates['kindlechat/art_index/' + child.key] = null;
            artCount++;
        });
        if (artCount > 0) {
            await socialRtdb.ref().update(artUpdates);
            summary.artEntries += artCount;
        }
    } catch (e) {
        throw new Error('Art index query failed: ' + e.message);
    }

    // Reactions the user added to other people's messages
    // (kindlechat/messages/{id}/reactions/{uid}). RTDB cannot query nested
    // children, so this is one pass over the retained message window — the
    // same full-node scan pattern used for suggestions and live games below.
    // A user's own messages are already gone, so only reactions on other
    // people's messages are found here.
    try {
        const messagesSnap = await socialRtdb.ref('kindlechat/messages').once('value');
        const reactionUpdates = {};
        let reactionCount = 0;
        let scanned = 0;
        messagesSnap.forEach(function (msg) {
            scanned++;
            if (scanned % 500 === 0) assertWithinBudget(deadline);
            if (!isSafeRtdbKey(msg.key)) return;
            if (!msg.child('reactions/' + uid).exists()) return;
            reactionUpdates['kindlechat/messages/' + msg.key + '/reactions/' + uid] = null;
            reactionCount++;
        });
        if (reactionCount > 0) {
            const groups = chunk(Object.keys(reactionUpdates), 2000);
            for (let i = 0; i < groups.length; i++) {
                const part = {};
                groups[i].forEach(function (key) { part[key] = null; });
                await socialRtdb.ref().update(part);
            }
            summary.rtdbNodes += reactionCount;
        }
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new Error('Reaction cleanup failed: ' + e.message);
    }

    // DM graph: every thread the user participates in, its messages, and every
    // participant's inbox row. Reading all threads covers a missing inbox row.
    const threadIds = {};
    const inboxSnap = await socialRtdb.ref('kindlechat/dm_user_threads/' + uid).once('value');
    inboxSnap.forEach(function (child) { if (isSafeRtdbKey(child.key)) threadIds[child.key] = true; });

    const allThreadsSnap = await socialRtdb.ref('kindlechat/dm_threads').once('value');
    allThreadsSnap.forEach(function (child) {
        const thread = child.val() || {};
        if (thread.participants && thread.participants[uid] === true && isSafeRtdbKey(child.key)) {
            threadIds[child.key] = true;
        }
    });

    const threadKeys = Object.keys(threadIds);
    for (let i = 0; i < threadKeys.length; i++) {
        assertWithinBudget(deadline);
        const threadId = threadKeys[i];
        const threadSnap = await socialRtdb.ref('kindlechat/dm_threads/' + threadId).once('value');
        const thread = threadSnap.val() || {};

        const messagesSnap = await socialRtdb.ref('kindlechat/dm_messages/' + threadId).once('value');
        const messageChunks = chunk(Object.keys(messagesSnap.val() || {}), CHAT_BATCH_SIZE);
        for (let j = 0; j < messageChunks.length; j++) {
            assertWithinBudget(deadline);
            const updates = {};
            messageChunks[j].forEach(function (msgId) {
                if (isSafeRtdbKey(msgId)) updates['kindlechat/dm_messages/' + threadId + '/' + msgId] = null;
            });
            if (Object.keys(updates).length > 0) {
                await socialRtdb.ref().update(updates);
                summary.dmMessages += Object.keys(updates).length;
            }
        }

        const updates = {};
        updates['kindlechat/dm_threads/' + threadId] = null;
        updates['kindlechat/dm_user_threads/' + uid + '/' + threadId] = null;
        Object.keys(thread.participants || {}).forEach(function (participant) {
            if (participant !== uid && isSafeRtdbKey(participant)) {
                updates['kindlechat/dm_user_threads/' + participant + '/' + threadId] = null;
            }
        });
        await socialRtdb.ref().update(updates);
        summary.dmThreads++;
    }

    // DM blocks in either direction.
    const blocksSnap = await socialRtdb.ref('kindlechat/dm_blocks').once('value');
    const blockUpdates = {};
    blocksSnap.forEach(function (userNode) {
        userNode.forEach(function (targetNode) {
            if (userNode.key !== uid && targetNode.key !== uid) return;
            if (!isSafeRtdbKey(userNode.key) || !isSafeRtdbKey(targetNode.key)) return;
            blockUpdates['kindlechat/dm_blocks/' + userNode.key + '/' + targetNode.key] = null;
        });
    });
    if (Object.keys(blockUpdates).length > 0) {
        await socialRtdb.ref().update(blockUpdates);
    }

    // Reports authored by, or about, the user. Both directions are removed:
    // after the account is gone the report can no longer be actioned, and the
    // record contains a snapshot of the user's content.
    const reportIds = {};
    const reportQueries = ['reporterId', 'reportedUserId'];
    for (let i = 0; i < reportQueries.length; i++) {
        try {
            const snap = await socialRtdb.ref('reports')
                .orderByChild(reportQueries[i]).equalTo(uid).once('value');
            snap.forEach(function (child) {
                if (!isSafeRtdbKey(child.key)) return;
                if (shouldDeleteReportForUser(child.val(), uid)) reportIds[child.key] = true;
            });
        } catch (e) {
            throw new Error('Report query (' + reportQueries[i] + ') failed: ' + e.message);
        }
    }
    const reportKeys = Object.keys(reportIds);
    if (reportKeys.length > 0) {
        const reportUpdates = {};
        reportKeys.forEach(function (id) { reportUpdates['reports/' + id] = null; });
        await socialRtdb.ref().update(reportUpdates);
        summary.reports += reportKeys.length;
    }
}

async function cleanupPrimaryRtdb(ctx) {
    const { uid, handle, rtdb, socialRtdb, summary, deadline } = ctx;

    const primaryPaths = buildPrimaryUserDeletePaths(uid, handle);
    const socialPaths = buildSocialUserDeletePaths(uid);
    const nodeCount = Object.keys(primaryPaths).length + Object.keys(socialPaths).length;
    if (Object.keys(primaryPaths).length > 0) await rtdb.ref().update(primaryPaths);
    if (Object.keys(socialPaths).length > 0) await socialRtdb.ref().update(socialPaths);
    summary.rtdbNodes += nodeCount;

    // Suggestions (RTDB): own ideas, upvotes and comments on other ideas.
    try {
        const ownSnap = await rtdb.ref('suggestions')
            .orderByChild('authorUid').equalTo(uid).once('value');
        const ownUpdates = {};
        let ownCount = 0;
        ownSnap.forEach(function (child) {
            if (!isSafeRtdbKey(child.key)) return;
            ownUpdates['suggestions/' + child.key] = null;
            ownCount++;
        });
        if (ownCount > 0) {
            await rtdb.ref().update(ownUpdates);
            summary.suggestions += ownCount;
        }

        const allSnap = await rtdb.ref('suggestions').once('value');
        const updates = {};
        allSnap.forEach(function (suggestion) {
            if (suggestion.child('upvotes/' + uid).exists()) {
                if (isSafeRtdbKey(suggestion.key)) {
                    updates['suggestions/' + suggestion.key + '/upvotes/' + uid] = null;
                }
            }
            suggestion.child('comments').forEach(function (comment) {
                const value = comment.val() || {};
                if (value.authorUid === uid && isSafeRtdbKey(suggestion.key) && isSafeRtdbKey(comment.key)) {
                    updates['suggestions/' + suggestion.key + '/comments/' + comment.key] = null;
                }
            });
        });
        if (Object.keys(updates).length > 0) await rtdb.ref().update(updates);
    } catch (e) {
        // Personal content must not be silently left behind before Auth is
        // deleted; abort and let the user retry.
        if (e instanceof HttpsError) throw e;
        throw new Error('Suggestions cleanup failed: ' + e.message);
    }

    // AirType freewrite sessions contain note content. They are short-lived,
    // so a full scan is cheap.
    try {
        const sessionsSnap = await rtdb.ref('freewrite_sessions').once('value');
        const updates = {};
        sessionsSnap.forEach(function (session) {
            const value = session.val() || {};
            if (value.ownerId === uid && isSafeRtdbKey(session.key)) {
                updates['freewrite_sessions/' + session.key] = null;
            }
        });
        if (Object.keys(updates).length > 0) await rtdb.ref().update(updates);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new Error('Freewrite cleanup failed: ' + e.message);
    }

    // Live-game listings hosted by the user (ghost lobbies otherwise linger
    // until the index validator removes them). Also remove the user's chat
    // lines from every live match and their presence from open lobbies. Active
    // match state is deliberately left alone: deleting a player mid-game would
    // corrupt the match for everyone else, and turns/AFK timers already deal
    // with a vanished player.
    try {
        const mmSnap = await rtdb.ref('matchmaking').once('value');
        const updates = {};
        mmSnap.forEach(function (gameNode) {
            gameNode.forEach(function (matchNode) {
                const value = matchNode.val() || {};
                if (value.hostUid === uid && isSafeRtdbKey(gameNode.key) && isSafeRtdbKey(matchNode.key)) {
                    updates['matchmaking/' + gameNode.key + '/' + matchNode.key] = null;
                }
            });
        });

        const gamesSnap = await rtdb.ref('games').once('value');
        gamesSnap.forEach(function (gameNode) {
            gameNode.forEach(function (matchNode) {
                if (!isSafeRtdbKey(gameNode.key) || !isSafeRtdbKey(matchNode.key)) return;
                const base = 'games/' + gameNode.key + '/' + matchNode.key;
                const match = matchNode.val() || {};
                matchNode.child('chat').forEach(function (msg) {
                    const value = msg.val() || {};
                    if (value.uid === uid && isSafeRtdbKey(msg.key)) {
                        updates[base + '/chat/' + msg.key] = null;
                    }
                });
                if (match.status === 'lobby' && match.players && match.players[uid]) {
                    updates[base + '/players/' + uid] = null;
                }
            });
        });

        if (Object.keys(updates).length > 0) await rtdb.ref().update(updates);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new Error('Matchmaking/game cleanup failed: ' + e.message);
    }

    assertWithinBudget(deadline);
}

/* -------------------------------------------------------------------------- */
/* Storage / Auth                                                              */
/* -------------------------------------------------------------------------- */

async function cleanupStorage(ctx) {
    const { uid, summary } = ctx;

    // Firebase projects can expose both `<project>.appspot.com` and
    // `<project>.firebasestorage.app`; the browser writes to the latter in this
    // project. Try the configured bucket plus both known naming schemes so a
    // wrong default (admin.storage().bucket() with no name) cannot silently
    // leave the user's files behind. A 404 just means that bucket/prefix is
    // empty; any other error aborts BEFORE the Auth record is deleted.
    let firebaseConfig = {};
    try {
        firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
    } catch (e) {
        firebaseConfig = {};
    }
    const projectId = firebaseConfig.projectId || process.env.GCLOUD_PROJECT || '';
    const names = [];
    if (firebaseConfig.storageBucket) names.push(firebaseConfig.storageBucket);
    if (projectId) {
        names.push(projectId + '.firebasestorage.app');
        names.push(projectId + '.appspot.com');
    }
    if (names.length === 0) names.push(undefined);

    const tried = {};
    let deletedAny = false;
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const key = name || '__default__';
        if (tried[key]) continue;
        tried[key] = true;
        try {
            const bucket = admin.storage().bucket(name);
            await bucket.deleteFiles({ prefix: 'users/' + uid + '/', force: true });
            deletedAny = true;
        } catch (e) {
            const code = Number(e && e.code);
            const text = String((e && e.message) || '');
            if (code === 404 || /not[ -]?found|does not exist/i.test(text)) {
                // Try the next bucket name.
                continue;
            }
            // A permission error on a *fallback* bucket name (e.g. an
            // inaccessible legacy .appspot.com bucket) must not block deletion
            // once the configured bucket has been handled.
            const isConfiguredBucket = i === 0 && !!firebaseConfig.storageBucket;
            if (code === 403 && !isConfiguredBucket) {
                logger.warn('deleteAccount: skipped inaccessible fallback storage bucket', { uid: uid, bucket: key });
                continue;
            }
            throw new Error('Storage cleanup failed for ' + key + ': ' + text);
        }
    }
    if (deletedAny) summary.storageObjects += 1;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

async function deleteAccount(request, deps) {
    if (!request.auth || !request.auth.uid) {
        throw new HttpsError('unauthenticated', 'You must be signed in to delete your account.');
    }
    const socialApp = deps && deps.socialApp;
    if (!socialApp) {
        throw new HttpsError('failed-precondition', 'Account deletion is temporarily unavailable. Please try again later.');
    }

    const uid = request.auth.uid;
    if (!isValidUid(uid)) {
        throw new HttpsError('invalid-argument', 'Invalid account identifier.');
    }

    // Require a fresh sign-in. The page performs a password
    // reauthentication and forces a token refresh; the server can only verify
    // the resulting auth_time (see the threat-model note in
    // docs/agent/account-deletion.md). Any session signed in within the window
    // can call the function directly, so do not lengthen the window casually.
    if (!isRecentAuth(request.auth.token && request.auth.token.auth_time, Date.now(), RECENT_AUTH_MAX_SECONDS)) {
        throw new HttpsError(
            'failed-precondition',
            'Please sign in again before deleting your account.',
            { code: 'recent-login-required' }
        );
    }

    const data = request.data || {};
    const confirmation = data.confirmation;
    if (typeof confirmation !== 'string' || !confirmation.trim()) {
        throw new HttpsError('invalid-argument', 'Type your username to confirm deletion.');
    }

    const email = request.auth.token.email || '';
    const handle = emailHandle(email);
    let username = handle;
    if (!username) {
        try {
            const snap = await admin.database().ref('users_public/' + uid + '/username').once('value');
            username = pickUsername([snap.val(), handle]);
        } catch (e) {
            username = '';
        }
    }

    if (!confirmationMatches(confirmation, username)) {
        throw new HttpsError(
            'permission-denied',
            'The username you typed does not match this account.',
            { code: 'confirmation-mismatch' }
        );
    }

    const db = admin.firestore();
    const rtdb = admin.database();
    const socialDb = socialApp.firestore();
    const socialRtdb = socialApp.database();
    const socialAuth = socialApp.auth();
    const summary = emptySummary();
    const deadline = Date.now() + DELETION_TIME_BUDGET_MS;
    const ctx = { uid: uid, handle: handle, email: email, db: db, rtdb: rtdb, socialDb: socialDb, socialRtdb: socialRtdb, summary: summary, deadline: deadline };

    logger.info('deleteAccount: starting', { uid: uid });

    try {
        // Billing must be handled before the user document is deleted, because
        // that is where the Stripe customer id lives.
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            const stripeCustomerId = userDoc.exists ? (userDoc.get('stripeCustomerId') || '') : '';
            if (stripeCustomerId) {
                const stripeResult = await cancelStripeSubscription(stripeCustomerId, uid);
                if (stripeResult.cancelled > 0) {
                    logger.info('deleteAccount: cancelled Stripe subscriptions', { uid: uid, count: stripeResult.cancelled });
                }
            }
        } catch (e) {
            logger.warn('deleteAccount: billing cleanup failed', { uid: uid, message: e.message });
        }

        await cleanupSocialFirestore(ctx);
        await cleanupSocialRtdb(ctx);
        await cleanupPrimaryFirestore(ctx);
        await cleanupPrimaryRtdb(ctx);
        await cleanupStorage(ctx);

        // Social-project Auth record (created by getSocialToken). Treat a
        // missing record as success; any other failure aborts before the
        // primary Auth is removed so the operation can be retried.
        try {
            await socialAuth.deleteUser(uid);
            summary.authUsers++;
        } catch (e) {
            if (e.code !== SOCIAL_AUTH_NOT_FOUND) throw e;
        }

        assertWithinBudget(deadline);

        // LAST: the Auth record. Everything above is idempotent, so a retry
        // after a timeout simply continues with what is left.
        try {
            await admin.auth().deleteUser(uid);
            summary.authUsers++;
        } catch (e) {
            if (e.code !== SOCIAL_AUTH_NOT_FOUND) throw e;
        }
    } catch (e) {
        logger.error('deleteAccount: failed', { uid: uid, message: e.message });
        if (e instanceof HttpsError) throw e;
        throw new HttpsError(
            'internal',
            'Account deletion could not finish. Your account is still active; please try again.',
            { code: 'deletion-incomplete' }
        );
    }

    logger.info('deleteAccount: completed', { uid: uid, counts: summary });
    return { deleted: true, counts: summary };
}

module.exports = {
    deleteAccount: deleteAccount,
    // Exported for scripts/test-account-deletion.js and future admin tooling.
    cancelStripeSubscription: cancelStripeSubscription
};
