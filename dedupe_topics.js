const admin = require('firebase-admin');
const fs = require('fs');
const readline = require('readline');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = './service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

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

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (q) => new Promise(res => rl.question(q, res));

function getWords(title) {
    const stopWords = ['the', 'and', 'chat', 'room', 'fans', 'lovers', 'today', 'for', 'about', 'with', 'over', 'vs', 'de', 'la', 'los', 'las', 'el', 'en', 'da', 'do', 'na', 'no', 'of', 'in', 'to', 'is', 'on', 'at', 'my', 'me', 'it'];
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.includes(w));
}

function areSimilar(t1, t2) {
    const w1 = getWords(t1);
    const w2 = getWords(t2);
    
    const set1 = new Set(w1);
    let hasCommonWord = false;
    for (const w of w2) {
        if (set1.has(w)) {
            hasCommonWord = true;
            break;
        }
    }
    
    let str1 = t1.toLowerCase().replace(/[^a-z0-9]/g, '');
    let str2 = t2.toLowerCase().replace(/[^a-z0-9]/g, '');
    let isSubset = (str1.length >= 4 && str2.includes(str1)) || (str2.length >= 4 && str1.includes(str2));
    
    return hasCommonWord || isSubset;
}

async function main() {
    console.log("Fetching topics from Realtime Database...");
    
    const topicsSnap = await rtdb.ref('topics').once('value');
    const topics = topicsSnap.val() || {};
    
    const docs = Object.entries(topics).map(([id, data]) => ({
        id,
        ...data,
        title: data.title || ''
    }));
    
    let pairs = [];
    for (let i = 0; i < docs.length; i++) {
        for (let j = i + 1; j < docs.length; j++) {
            if (areSimilar(docs[i].title, docs[j].title)) {
                pairs.push([docs[i], docs[j]]);
            }
        }
    }
    
    if (pairs.length === 0) {
        console.log("No similar topics found.");
        rl.close();
        process.exit(0);
        return;
    }
    
    console.log(`\nFound ${pairs.length} pairs of potentially similar topics.`);
    
    let deletedIds = new Set();
    
    for (let i = 0; i < pairs.length; i++) {
        const [t1, t2] = pairs[i];
        
        // Skip if either has already been merged into something else
        if (deletedIds.has(t1.id) || deletedIds.has(t2.id)) {
            continue;
        }
        
        console.log(`\n========================================`);
        console.log(`Pair ${i+1} of ${pairs.length}`);
        
        const formatTopic = (t, idx) => {
            const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleString() : 'Unknown';
            const author = t.authorId || 'Unknown';
            const count = t.commentCount || 0;
            return `  [${idx}] "${t.title}" (ID: ${t.id} | Author: ${author} | Comments: ${count})`;
        };
        
        console.log(formatTopic(t1, 1));
        console.log(formatTopic(t2, 2));
        
        const action = await ask("\nMerge (y) / Delete one (d) / Delete both (b) / Skip (n)? ");
        const actionLower = action.toLowerCase();
        
        if (actionLower === 'b') {
            const confirmed = await ask(`Are you sure you want to delete BOTH "${t1.title}" and "${t2.title}"? (y/n) `);
            if (confirmed.toLowerCase() === 'y') {
                console.log(`\nDeleting BOTH topics...`);
                await rtdb.ref(`topic_comments/${t1.id}`).remove();
                await rtdb.ref(`topics/${t1.id}`).remove();
                deletedIds.add(t1.id);
                console.log(`- Deleted topic & comments for ${t1.id}`);
                
                await rtdb.ref(`topic_comments/${t2.id}`).remove();
                await rtdb.ref(`topics/${t2.id}`).remove();
                deletedIds.add(t2.id);
                console.log(`- Deleted topic & comments for ${t2.id}`);
            } else {
                console.log("Skipping...");
            }
            continue;
        }

        if (actionLower === 'd') {
            const delStr = await ask(`Select which one to DELETE (1 or 2): `);
            const choice = parseInt(delStr, 10);
            if (choice === 1 || choice === 2) {
                const toDelete = choice === 1 ? t1 : t2;
                console.log(`\nDeleting [${choice}] "${toDelete.title}"...`);
                await rtdb.ref(`topic_comments/${toDelete.id}`).remove();
                await rtdb.ref(`topics/${toDelete.id}`).remove();
                deletedIds.add(toDelete.id);
                console.log(`- Deleted topic & comments for ${toDelete.id}`);
            } else {
                console.log("Invalid choice, skipping...");
            }
            continue;
        }
        
        if (actionLower !== 'y') {
            continue;
        }
        
        const primaryStr = await ask(`Select which one to KEEP as primary (1 or 2): `);
        const choice = parseInt(primaryStr, 10);
        
        if (choice !== 1 && choice !== 2) {
            console.log("Invalid choice, skipping...");
            continue;
        }
        
        const primary = choice === 1 ? t1 : t2;
        const duplicate = choice === 1 ? t2 : t1;
        
        console.log(`\nMerging [${choice}] "${duplicate.title}" into "${primary.title}"...`);
        let totalCommentsMoved = 0;
        
        // Read duplicate comments
        const dupCommentsSnap = await rtdb.ref(`topic_comments/${duplicate.id}`).once('value');
        const dupComments = dupCommentsSnap.val() || {};
        const keys = Object.keys(dupComments);
        
        if (keys.length > 0) {
            for (const commentData of Object.values(dupComments)) {
                await rtdb.ref(`topic_comments/${primary.id}`).push(commentData);
                totalCommentsMoved++;
            }
        }
        
        // Delete duplicate
        await rtdb.ref(`topic_comments/${duplicate.id}`).remove();
        await rtdb.ref(`topics/${duplicate.id}`).remove();
        deletedIds.add(duplicate.id);
        console.log(`- Deleted duplicate topic & comments for ${duplicate.id}`);
        
        if (totalCommentsMoved > 0) {
            console.log(`+ Transferred ${totalCommentsMoved} comments to primary topic.`);
            
            // Update primary topic's commentCount
            await rtdb.ref(`topics/${primary.id}/commentCount`).transaction(current => {
                return (current || 0) + totalCommentsMoved;
            });
            
            // Update lastActive to the max of both topics to reflect true latest activity
            const maxLastActive = Math.max(
                primary.lastActive || primary.createdAt || 0,
                duplicate.lastActive || duplicate.createdAt || 0
            );
            if (maxLastActive > 0) {
                await rtdb.ref(`topics/${primary.id}/lastActive`).set(maxLastActive);
            }
        }
        
        console.log("Done merging this pair.");
    }
    
    console.log("\n========================================");
    console.log("Finished deduplication process.");
    rl.close();
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
