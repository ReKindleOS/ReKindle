const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = './service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);
const TARGET_IP = args[0];
const FORMATTED_IP = TARGET_IP ? TARGET_IP.replace(/\./g, '-').replace(/:/g, '_') : null;
const BAN_ACCOUNTS_MODE = args.includes('--ban-accounts');

// --- INIT ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Error: Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
}

if (!TARGET_IP || TARGET_IP.startsWith('--')) {
    console.error(`Usage: node ban_ip.js <IP_ADDRESS> [--ban-accounts]`);
    console.error(`  --ban-accounts : Optionally disable all users found with this IP address`);
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const rtdb = admin.database();

async function main() {
    console.log(`\n=== ReKindle IP Ban Tool ===`);
    console.log(`Target IP: ${TARGET_IP}`);
    console.log(`Firebase Path: /banned_ips/${FORMATTED_IP}\n`);

    try {
        // 1. Add IP to banned_ips
        console.log(`Adding IP to banned_ips list...`);
        await rtdb.ref(`banned_ips/${FORMATTED_IP}`).set({
            timestamp: admin.database.ServerValue.TIMESTAMP,
            bannedBy: 'admin_script'
        });
        console.log(`[SUCCESS] IP has been banned. New sign-ups and logins from this IP are blocked.`);

        // 2. Scan and optionally ban existing users
        console.log(`\nScanning database for users with this IP...`);
        const usersPrivateSnap = await rtdb.ref('users_private').once('value');
        const users = usersPrivateSnap.val() || {};
        
        let matchingUids = [];
        for (const uid of Object.keys(users)) {
            if (users[uid].ipAddress === TARGET_IP) {
                matchingUids.push(uid);
            }
        }

        if (matchingUids.length === 0) {
            console.log(`No users found tracking to this IP.`);
        } else {
            console.log(`Found ${matchingUids.length} user(s) matching this IP:`);
            matchingUids.forEach(u => console.log(` - UID: ${u}`));

            if (BAN_ACCOUNTS_MODE) {
                console.log(`\nDisabling accounts in Firebase Auth...`);
                let successCount = 0;
                let failCount = 0;
                for (const uid of matchingUids) {
                    try {
                        await admin.auth().updateUser(uid, { disabled: true });
                        console.log(`[OK] Disabled: ${uid}`);
                        successCount++;
                    } catch (e) {
                        console.error(`[FAIL] Error disabling ${uid}: ${e.message}`);
                        failCount++;
                    }
                }
                console.log(`\nAccount Bans Complete. (${successCount} disabled, ${failCount} failed)`);
                console.log(`Note: To clean up these accounts' data, run the wipe_banned_users.js script.`);
            } else {
                console.log(`\nHINT: Their existing accounts remain active. Run again with --ban-accounts to disable them.`);
            }
        }

    } catch (e) {
        console.error("Fatal Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
