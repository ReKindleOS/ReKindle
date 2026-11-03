/**
 * Read-only leaderboard audit.
 *
 * Dumps every entry of every leaderboard collection to
 * admin/backups/audit-<timestamp>.json and prints the top of each board so a
 * human can spot values that are inside the configured hard bounds but still
 * obviously impossible (the bounds only catch Infinity / 6.7e67 / out-of-range
 * values, not "660000 on surfer").
 *
 * Usage:
 *   node audit_leaderboards.js            # top 8 per board
 *   node audit_leaderboards.js 25         # top 25 per board
 *
 * This script never writes to Firebase.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { COLLECTIONS } = require('../firebase-functions/score-config');

admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, '..', 'service-account.json')))
});

const db = admin.firestore();
const TOP = Math.max(1, parseInt(process.argv[2], 10) || 8);

function millis(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

(async () => {
    const report = { generatedAt: new Date().toISOString(), boards: {} };
    const collections = Object.keys(COLLECTIONS);

    for (const collection of collections) {
        const rules = COLLECTIONS[collection].fields || {};
        const primary = Object.keys(rules)[0];
        const snap = await db.collection(collection).get();
        const rows = [];

        snap.forEach((doc) => {
            const data = doc.data() || {};
            const values = {};
            Object.keys(rules).forEach((key) => {
                values[key] = data[key] === undefined ? null : data[key];
            });
            rows.push({
                id: doc.id,
                username: typeof data.username === 'string' ? data.username : null,
                timestamp: millis(data.timestamp),
                verified: data.verified === true,
                values: values
            });
        });

        rows.sort((a, b) => {
            const av = a.values[primary];
            const bv = b.values[primary];
            if (typeof av !== 'number' || typeof bv !== 'number') return 0;
            return rules[primary].dir === 'lower' ? av - bv : bv - av;
        });

        report.boards[collection] = { count: rows.length, primary: primary, rows: rows };
    }

    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`Audit written to ${file}\n`);

    collections.forEach((collection) => {
        const board = report.boards[collection];
        console.log(`\n${collection}  (${board.count} entries, ranked by ${board.primary})`);
        board.rows.slice(0, TOP).forEach((row, index) => {
            const at = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 16).replace('T', ' ') : '?';
            console.log(`  ${String(index + 1).padStart(2)}. ${JSON.stringify(row.values)}  user=${row.username || '?'}  verified=${row.verified}  at=${at}  id=${row.id}`);
        });
    });
})().catch((e) => {
    console.error('Audit failed:', e);
    process.exit(1);
});
