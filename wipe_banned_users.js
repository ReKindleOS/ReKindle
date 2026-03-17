const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = './service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);
const FORCE_MODE = args.includes('--force');

// --- INIT ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Error: Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const rtdb = admin.database();

let deletionTasks = [];

async function main() {
    console.log(`\n=== ReKindle Banned Users Cleanup Tool ===`);
    console.log(`Mode: ${FORCE_MODE ? 'WET RUN (DELETING)' : 'DRY RUN (READ ONLY)'}\n`);

    try {
        const bannedUids = await getBannedUsers();
        if (bannedUids.size === 0) {
            console.log("No banned users found.");
            process.exit(0);
        }

        console.log(`Found ${bannedUids.size} disabled (banned) users.`);

        // Scan users_public
        await scanUsersPublic(bannedUids);

        // Scan Neighbourhood
        await scanNeighbourhood(bannedUids);

        console.log(`\n=== Summary ===`);
        console.log(`Total items found for deletion: ${deletionTasks.length}`);

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

async function getBannedUsers() {
    console.log("Fetching users from Firebase Auth...");
    const disabledUids = new Set();
    let nextPageToken;

    do {
        const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
        listUsersResult.users.forEach((userRecord) => {
            if (userRecord.disabled) {
                disabledUids.add(userRecord.uid);
            }
        });
        nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    return disabledUids;
}

async function scanUsersPublic(bannedUids) {
    console.log("Scanning users_public for profiles...");
    const profilesSnap = await rtdb.ref('users_public').once('value');
    const profiles = profilesSnap.val() || {};

    for (const uid of Object.keys(profiles)) {
        if (bannedUids.has(uid)) {
            deletionTasks.push({
                type: 'Public Profile',
                id: uid,
                summary: profiles[uid].displayName || 'Unknown user',
                action: () => rtdb.ref(`users_public/${uid}`).remove()
            });
        }
    }
}

async function scanNeighbourhood(bannedUids) {
    console.log("Scanning Neighbourhood posts and comments...");
    const postsRef = rtdb.ref('neighbourhood_posts');
    const allPostsSnap = await postsRef.once('value');
    
    if (!allPostsSnap.exists()) return;

    allPostsSnap.forEach(postNode => {
        const postId = postNode.key;
        const post = postNode.val();

        if (bannedUids.has(post.uid)) {
            deletionTasks.push({
                type: 'Neighbourhood Post',
                id: postId,
                summary: (post.text || '').substring(0, 50),
                action: () => postsRef.child(postId).remove()
            });
            // If the whole post is removed, we don't need to process its comments separately.
            return;
        }

        // Process comments on non-banned users' posts
        const comments = post.comments;
        if (comments) {
            Object.entries(comments).forEach(([commentId, commentData]) => {
                if (bannedUids.has(commentData.uid)) {
                    deletionTasks.push({
                        type: 'Neighbourhood Comment',
                        id: commentId,
                        summary: (commentData.text || '').substring(0, 50),
                        action: () => postsRef.child(`${postId}/comments/${commentId}`).remove()
                    });
                }
            });
        }
    });
}

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
