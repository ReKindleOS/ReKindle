const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = './service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);

function printUsage() {
    console.log('Usage:');
    console.log('  node timeout_user.js <username_or_uid> <hours> "<reason>"');
    console.log('  node timeout_user.js <username_or_uid> --clear');
    console.log('');
    console.log('Examples:');
    console.log('  node timeout_user.js baduser123 24 "Spamming in KindleChat"');
    console.log('  node timeout_user.js baduser123 0.5 "Cool off for 30 minutes"');
    console.log('  node timeout_user.js baduser123 --clear');
    process.exit(1);
}

if (args.length < 2) {
    printUsage();
}

const TARGET = args[0];
const IS_CLEAR = args[1] === '--clear';
const HOURS = IS_CLEAR ? 0 : parseFloat(args[1]);
const REASON = IS_CLEAR ? '' : (args[2] || '');

if (!IS_CLEAR && (isNaN(HOURS) || HOURS <= 0)) {
    console.error('Error: Hours must be a positive number.');
    printUsage();
}

if (!IS_CLEAR && !REASON) {
    console.error('Error: A reason is required.');
    printUsage();
}

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

// --- RESOLVE USER ---
async function resolveUser(target) {
    // Check if input is already a UID
    if (target.length > 20 && !target.includes(' ')) {
        try {
            const userRecord = await admin.auth().getUser(target);
            return {
                uid: userRecord.uid,
                name: userRecord.displayName || (userRecord.email || '').split('@')[0] || target
            };
        } catch (e) {
            // Not a valid Auth UID, treat as username
        }
    }

    // Lookup in users_public by displayName or email
    const snap = await rtdb.ref('users_public').once('value');
    const users = snap.val() || {};

    for (const [uid, data] of Object.entries(users)) {
        const name = (data.displayName || '').toLowerCase();
        const email = (data.email || '').toLowerCase();
        const t = target.toLowerCase();

        if (name === t || email.startsWith(t + '@') || uid === target) {
            return { uid, name: data.displayName || t };
        }
    }

    return null;
}

// --- MAIN ---
async function main() {
    console.log('\n=== ReKindle Social Timeout Tool ===');
    console.log(`Target: ${TARGET}`);
    console.log(`Action: ${IS_CLEAR ? 'CLEAR TIMEOUT' : `TIMEOUT for ${HOURS}h`}`);
    if (REASON) console.log(`Reason: ${REASON}`);
    console.log('');

    try {
        const user = await resolveUser(TARGET);

        if (!user) {
            console.error(`Could not resolve user "${TARGET}". Exiting.`);
            process.exit(1);
        }

        console.log(`Resolved: ${user.name} (UID: ${user.uid})`);

        if (IS_CLEAR) {
            // Remove the timeout and the seen timestamp
            await rtdb.ref('social_timeouts/' + user.uid).remove();
            await rtdb.ref('users_private/' + user.uid + '/timeout_seen').remove();
            console.log('\n[OK] Timeout cleared. User can access social features immediately.');
        } else {
            // Set the timeout
            await rtdb.ref('social_timeouts/' + user.uid).set({
                reason: REASON,
                durationHours: HOURS
            });
            // Clear any previous seenAt so the countdown starts fresh
            await rtdb.ref('users_private/' + user.uid + '/timeout_seen').remove();

            console.log(`\n[OK] User timed out for ${HOURS} hour(s).`);
            console.log(`     Reason: "${REASON}"`);
            console.log('     Countdown begins when they next open a social app.');
        }

    } catch (e) {
        console.error('Fatal Error:', e);
    } finally {
        process.exit(0);
    }
}

main();
