const admin = require('firebase-admin');
const fs = require('fs');
const readline = require('readline');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = './service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: node cleanup_user.js <username_or_uid> [--force]');
    process.exit(1);
}

const TARGET_USERNAME = args[0];
const FORCE_MODE = args.includes('--force');

// --- INIT ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Error: Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
    console.error('Please download it from Firebase Console -> Project Settings -> Service Accounts');
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const db = admin.firestore();
const rtdb = admin.database();

// --- STATE ---
let targetUid = null;
let targetUsername = null; // The display/kindle name
let deletionTasks = [];

async function main() {
    console.log(`\n=== ReKindle User Cleanup Tool ===`);
    console.log(`Target: ${TARGET_USERNAME}`);
    console.log(`Mode: ${FORCE_MODE ? 'WET RUN (DELETING)' : 'DRY RUN (READ ONLY)'}\n`);

    try {
        await resolveUser();
        if (!targetUid) {
            console.error("Could not resolve user. Exiting.");
            process.exit(1);
        }

        console.log(`Resolved User: ${targetUsername} (UID: ${targetUid})`);

        // 1. Scan KindleChat RTDB
        await scanKindleChatRTDB();

        // 2. Scan KindleChat Firestore
        await scanKindleChatFirestore();

        // 3. Scan Topics
        await scanTopics();

        // 4. Scan Neighbourhood
        await scanNeighbourhood();

        console.log(`\n=== Summary ===`);
        console.log(`Total items found: ${deletionTasks.length}`);

        if (deletionTasks.length > 0) {
            if (FORCE_MODE) {
                await executeDeletions();
            } else {
                console.log(`\n[DRY RUN] No changes made. Run with --force to execute.`);
            }
        }

    } catch (e) {
        console.error("Fatal Error:", e);
    } finally {
        process.exit(0);
    }
}

// --- RESOLVE USER ---
async function resolveUser() {
    console.log("Resolving user...");

    // Check if input is already a UID (simple heuristic)
    if (TARGET_USERNAME.length > 20 && !TARGET_USERNAME.includes(' ')) {
        // Verify existence
        try {
            const userRecord = await admin.auth().getUser(TARGET_USERNAME);
            targetUid = userRecord.uid;
            // For KindleChat, we need the email handle, NOT the display name
            const email = userRecord.email || '';
            targetUsername = email.split('@')[0] || userRecord.displayName || 'Unknown';
            return;
        } catch (e) {
            // Not a valid Auth UID, treat as username
        }
    }

    // Lookup in users_public
    const snap = await rtdb.ref('users_public').once('value');
    const users = snap.val() || {};

    // 2. Search by displayName or Email
    for (const [uid, data] of Object.entries(users)) {
        const name = (data.displayName || '').toLowerCase();
        const email = (data.email || '').toLowerCase();
        const target = TARGET_USERNAME.toLowerCase();

        if (name === target || email.startsWith(target + '@') || uid === TARGET_USERNAME) {
            targetUid = uid;

            // CRITICAL FIX: KindleChat uses the EMAIL HANDLE (lowercase usually), NOT the Display Name
            // We must fetch the Auth record to be sure of the email handle
            try {
                const userRecord = await admin.auth().getUser(uid);
                const authEmail = userRecord.email || '';
                targetUsername = authEmail.split('@')[0] || data.displayName;
                console.log(`Resolved Identity: Display="${data.displayName}", KindleChatUser="${targetUsername}"`);
            } catch (e) {
                console.warn("Could not fetch Auth record, falling back to DisplayName:", e);
                targetUsername = data.displayName || 'Unknown';
            }
            return;
        }
    }

    console.warn(`Warning: Could not find strict UID mapping for '${TARGET_USERNAME}'.`);
    console.warn(`Assuming '${TARGET_USERNAME}' is the raw KindleChat username.`);
    targetUsername = TARGET_USERNAME;
}

// --- SCANNING ---

async function scanKindleChatRTDB() {
    console.log(`Scanning KindleChat (RTDB) for user='${targetUsername}'...`);
    const ref = rtdb.ref('kindlechat/messages');
    // Indexing might be needed for 'user' query
    const snap = await ref.orderByChild('user').equalTo(targetUsername).once('value');

    if (snap.exists()) {
        snap.forEach(child => {
            deletionTasks.push({
                type: 'KindleChat (General)',
                id: child.key,
                summary: (child.val().text || '').substring(0, 50),
                action: () => child.ref.remove()
            });
        });
    }
}

async function scanKindleChatFirestore() {
    console.log("Scanning KindleChat (Firestore)...");

    // Strategy: collectionGroup requires a custom index which might not exist. 
    // Fallback to querying rooms where user is a participant.
    // This matches the query used in the app, so it should be indexed.

    try {
        const roomsSnap = await db.collection('rooms')
            .where('participants', 'array-contains', targetUsername)
            .get();

        console.log(`Found ${roomsSnap.size} rooms to scan.`);

        for (const roomDoc of roomsSnap.docs) {
            const messagesSnap = await roomDoc.ref.collection('messages')
                .where('user', '==', targetUsername)
                .get();

            messagesSnap.forEach(doc => {
                deletionTasks.push({
                    type: `KindleChat (DM/Room: ${roomDoc.id})`,
                    id: doc.id,
                    summary: (doc.data().text || '').substring(0, 50),
                    action: () => doc.ref.delete()
                });
            });
        }
    } catch (e) {
        console.error("Error scanning Firestore rooms:", e);
        if (e.code === 9) {
            console.error("Tip: Ensure 'rooms' collection has an index for 'participants' array-contains.");
        }
    }
}

async function scanTopics() {
    if (!targetUid) {
        console.log("Skipping Topics (No UID resolved)");
        return;
    }
    console.log("Scanning Topics...");

    // 1. Topics created by user
    const topicsRef = rtdb.ref('topics');
    const topicsSnap = await topicsRef.orderByChild('authorId').equalTo(targetUid).once('value');

    topicsSnap.forEach(child => {
        deletionTasks.push({
            type: 'Topic',
            id: child.key,
            summary: (child.val().title || '').substring(0, 50),
            action: () => child.ref.remove()
        });
    });

    // 2. Comments (Deep search required if not indexed by author)
    // Structure: topic_comments/{topicId}/{commentId}
    // We can't query all comments easily without a global index or deep scan.
    // 'topic_comments' is the root for comments.
    const commentsRoot = rtdb.ref('topic_comments');
    const commentsSnap = await commentsRoot.once('value'); // Potentially heavy!

    commentsSnap.forEach(topicNode => {
        topicNode.forEach(commentNode => {
            if (commentNode.val().authorId === targetUid) {
                deletionTasks.push({
                    type: 'Topic Comment',
                    id: commentNode.key,
                    summary: (commentNode.val().text || '').substring(0, 50),
                    action: () => commentNode.ref.remove()
                });
            }
        });
    });
}

async function scanNeighbourhood() {
    if (!targetUid) {
        console.log("Skipping Neighbourhood (No UID resolved)");
        return;
    }
    console.log("Scanning Neighbourhood...");

    // 1. Posts
    const postsRef = rtdb.ref('neighbourhood_posts');
    const postsSnap = await postsRef.orderByChild('uid').equalTo(targetUid).once('value');

    postsSnap.forEach(child => {
        deletionTasks.push({
            type: 'Neighbourhood Post',
            id: child.key,
            summary: (child.val().text || '').substring(0, 50),
            action: () => child.ref.remove()
        });
    });

    // 2. Comments (Nested in posts)
    // Structure: neighbourhood_posts/{postId}/comments/{commentId}
    // We iterate ALL posts to find comments. (Optimized queries not possible without flat structure)
    // Since we already fetched specific posts, we need to fetch ALL posts now to find COMMENTS on others' posts.

    const allPostsSnap = await postsRef.once('value'); // Heavy read
    allPostsSnap.forEach(postNode => {
        const comments = postNode.val().comments;
        if (comments) {
            Object.entries(comments).forEach(([commentId, commentData]) => {
                if (commentData.uid === targetUid) {
                    deletionTasks.push({
                        type: 'Neighbourhood Comment',
                        id: commentId,
                        summary: (commentData.text || '').substring(0, 50),
                        action: () => rtdb.ref(`neighbourhood_posts/${postNode.key}/comments/${commentId}`).remove()
                    });
                }
            });
        }
    });
}

// --- EXECUTION ---
async function executeDeletions() {
    console.log(`\nExecuting ${deletionTasks.length} deletions...`);

    let deletedCount = 0;
    let errors = 0;

    for (const task of deletionTasks) {
        try {
            process.stdout.write(`Deleting ${task.type} (${task.id})... `);
            await task.action();
            process.stdout.write("DONE\n");
            deletedCount++;
        } catch (e) {
            process.stdout.write("FAILED\n");
            console.error(e.message);
            errors++;
        }
    }

    console.log(`\nOperation Complete.`);
    console.log(`Deleted: ${deletedCount}`);
    console.log(`Errors: ${errors}`);
}


main();
