const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = './service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: node nuke_user.js <username_or_uid> [--force]');
    console.error('This script will disable the user, ban their IP, and delete their content.');
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
    console.log(`\n=== ReKindle User NUKE Tool ===`);
    console.log(`Target: ${TARGET_USERNAME}`);
    console.log(`Mode: ${FORCE_MODE ? 'WET RUN (DELETING FOR REAL)' : 'DRY RUN (READ ONLY)'}\n`);

    try {
        await resolveUser();
        if (!targetUid) {
            console.error("Could not resolve user. Exiting.");
            process.exit(1);
        }

        console.log(`Resolved User: ${targetUsername} (UID: ${targetUid})`);

        // Execute Ban & IP Block
        await banUserAndIP();

        // 1. Scan KindleChat RTDB
        await scanKindleChatRTDB();

        // 2. Scan KindleChat Firestore
        await scanKindleChatFirestore();

        // 3. Scan Topics
        await scanTopics();

        // 4. Scan Neighbourhood
        await scanNeighbourhood();

        console.log(`\n=== Summary ===`);
        console.log(`Total items found for deletion: ${deletionTasks.length}`);

        if (deletionTasks.length > 0) {
            if (FORCE_MODE) {
                await executeDeletions();
            } else {
                console.log(`\n[DRY RUN] No changes made. Run with --force to execute bans and deletions.`);
            }
        } else {
            console.log(`\nNo content found to delete.`);
        }

    } catch (e) {
        console.error("Fatal Error:", e);
    } finally {
        process.exit(0);
    }
}

// --- BAN USER & IP ---
async function banUserAndIP() {
    console.log("\n--- Banning User and IP ---");
    try {
        const snap = await rtdb.ref(`users_private/${targetUid}/ipAddress`).once('value');
        const ip = snap.val();
        
        if (ip) {
            console.log(`Found associated IP address: ${ip}`);
            if (FORCE_MODE) {
                const formattedIp = ip.replace(/\./g, '-').replace(/:/g, '_');
                await rtdb.ref(`banned_ips/${formattedIp}`).set({
                    timestamp: admin.database.ServerValue.TIMESTAMP,
                    bannedBy: 'nuke_user_script',
                    bannedUid: targetUid
                });
                console.log(`[SUCCESS] IP ${ip} has been added to banned_ips list.`);
            }
        } else {
            console.log(`No IP address found for this user in users_private.`);
        }
        
        console.log(`Disabling Firebase Auth account for UID: ${targetUid}...`);
        if (FORCE_MODE) {
            await admin.auth().updateUser(targetUid, { disabled: true });
            console.log(`[SUCCESS] Account is now permanently disabled.`);
        }
    } catch (e) {
        console.error("Error during ban execution:", e);
    }
    console.log("----------------------------\n");
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

    // Search by displayName or Email or raw UID
    for (const [uid, data] of Object.entries(users)) {
        const name = (data.displayName || '').toLowerCase();
        const email = (data.email || '').toLowerCase();
        const target = TARGET_USERNAME.toLowerCase();

        if (name === target || email.startsWith(target + '@') || uid === TARGET_USERNAME) {
            targetUid = uid;

            // Fetch the auth record to be sure of the email handle which is used for kindlechat
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
    const commentsRoot = rtdb.ref('topic_comments');
    const commentsSnap = await commentsRoot.once('value'); 

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
    const allPostsSnap = await postsRef.once('value'); 
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
    console.log(`Deleted content chunks: ${deletedCount}`);
    console.log(`Errors: ${errors}`);
}

main();
