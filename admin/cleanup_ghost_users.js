const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = '../service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// Fields written by registerUser — anything beyond these indicates user has edited their profile
const AUTO_CREATED_KEYS = new Set(['displayName', 'username', 'email', 'createdAt', 'lastActive']);

// --- ARGS ---
const FORCE_MODE = process.argv.includes('--force');

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

const rtdb = admin.database();

function isNeverEdited(data) {
    // Must not have a custom avatar
    if (data.customAvatar) return false;

    // Display name must still equal username (never changed)
    if (data.displayName !== data.username) return false;

    // Must not have any fields beyond the auto-created set
    const extraKeys = Object.keys(data).filter(k => !AUTO_CREATED_KEYS.has(k));
    if (extraKeys.length > 0) return false;

    return true;
}

function formatDate(timestamp) {
    if (!timestamp) return 'unknown';
    return new Date(timestamp).toISOString().split('T')[0];
}

async function main() {
    console.log('\n=== ReKindle Ghost User Cleanup ===');
    console.log(`Mode: ${FORCE_MODE ? 'WET RUN (DELETING FOR REAL)' : 'DRY RUN (read-only)'}\n`);

    try {
        console.log('Fetching all users_public entries...');
        const snap = await rtdb.ref('users_public').once('value');
        const users = snap.val() || {};
        const total = Object.keys(users).length;
        console.log(`Total users_public entries: ${total}\n`);

        const ghosts = [];
        for (const [uid, data] of Object.entries(users)) {
            if (isNeverEdited(data)) {
                ghosts.push({ uid, username: data.username || data.displayName, createdAt: data.createdAt });
            }
        }

        console.log(`Ghost accounts found: ${ghosts.length} of ${total}\n`);

        if (ghosts.length === 0) {
            console.log('Nothing to do.');
            process.exit(0);
        }

        // Print table
        console.log('UID                                       Username             Created');
        console.log('─'.repeat(75));
        for (const g of ghosts) {
            console.log(`${g.uid.padEnd(40)} ${(g.username || '').padEnd(20)} ${formatDate(g.createdAt)}`);
        }
        console.log('');

        if (!FORCE_MODE) {
            console.log('[DRY RUN] No changes made. Run with --force to delete these profiles.');
            process.exit(0);
        }

        // Execute deletions
        console.log(`Deleting ${ghosts.length} ghost profiles...`);
        let deleted = 0;
        let errors = 0;

        for (const g of ghosts) {
            try {
                process.stdout.write(`  ${g.username || g.uid}... `);
                await Promise.all([
                    rtdb.ref(`users_public/${g.uid}`).remove(),
                    rtdb.ref(`users_private/${g.uid}`).remove()
                ]);
                process.stdout.write('DONE\n');
                deleted++;
            } catch (e) {
                process.stdout.write('FAILED\n');
                console.error(`  Error: ${e.message}`);
                errors++;
            }
        }

        console.log(`\nOperation complete.`);
        console.log(`Deleted: ${deleted}  Errors: ${errors}`);

    } catch (e) {
        console.error('Fatal error:', e);
    } finally {
        process.exit(0);
    }
}

main();
