const admin = require('firebase-admin');
const fs = require('fs');

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

async function main() {
    console.log("Fetching topics...");
    const topicsSnap = await rtdb.ref('topics').once('value');
    const topics = topicsSnap.val() || {};
    const topicIds = Object.keys(topics);
    
    console.log(`Found ${topicIds.length} topics. Recalculating lastActive and commentCount...`);
    
    let updatedCount = 0;
    
    for (const [index, id] of topicIds.entries()) {
        const topic = topics[id];
        
        // Fetch comments for this topic
        const commentsSnap = await rtdb.ref(`topic_comments/${id}`).once('value');
        const comments = commentsSnap.val() || {};
        
        // Find newest comment timestamp
        let maxTimestamp = topic.createdAt || 0;
        let commentCount = 0;
        for (const comment of Object.values(comments)) {
            if (comment.timestamp && comment.timestamp > maxTimestamp) {
                maxTimestamp = comment.timestamp;
            }
            commentCount++;
        }
        
        const currentCount = topic.commentCount || 0;
        
        if (maxTimestamp > 0 && String(topic.lastActive) !== String(maxTimestamp)) {
            process.stdout.write(`\rUpdating [${index + 1}/${topicIds.length}] (lastActive: ${topic.lastActive} -> ${maxTimestamp})                 `);
            await rtdb.ref(`topics/${id}/lastActive`).set(maxTimestamp);
            
            // Fix commentCount drift if there is any
            if (currentCount !== commentCount) {
                await rtdb.ref(`topics/${id}/commentCount`).set(commentCount);
            }
            
            updatedCount++;
        } else if (currentCount !== commentCount) {
            process.stdout.write(`\rUpdating [${index + 1}/${topicIds.length}] (commentCount: ${currentCount} -> ${commentCount})                 `);
            await rtdb.ref(`topics/${id}/commentCount`).set(commentCount);
            updatedCount++;
        }
    }
    
    console.log(`\n\nFinished! Updated ${updatedCount} topics.`);
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
