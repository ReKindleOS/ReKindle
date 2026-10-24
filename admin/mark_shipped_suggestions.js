/*
 * Mark Suggestions records that have definitely shipped as `done`.
 *
 * Usage:
 *   node admin/mark_shipped_suggestions.js            # dry run (default)
 *   node admin/mark_shipped_suggestions.js --apply    # write status:"done"
 *
 * The list is deliberately tiny and title-checked: if a record's title no
 * longer matches, the script refuses to touch it rather than guessing. Add a
 * row only when the feature is visible in the current build, not when it is
 * "planned" or "partly done".
 */
const path = require('path');
const admin = require('firebase-admin');
const serviceAccount = require(path.join(__dirname, '..', 'service-account.json'));

const APPLY = process.argv.includes('--apply');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/'
});

const SHIPPED = [
    {
        id: '-OyRrSOFqemOsnbF4AyJ',
        title: 'COOKIE CLICKERRR',
        why: 'Cookie Clicker shipped in cookieclicker.html (2026-10-24).'
    },
    {
        id: '-OyUwDI3f7Ds6aq376UU',
        title: 'ADD COOKIE CLICKER',
        why: 'Cookie Clicker shipped in cookieclicker.html (2026-10-24), including the Stimulation mode.'
    },
    {
        id: '-P4dTP4cU_zC_4k1yhzB',
        title: 'PLZ COOKIE CLICKERRRRRRR',
        why: 'Cookie Clicker shipped in cookieclicker.html (2026-10-24).'
    },
    {
        id: '-OyUItc9HyySFc6NhXXA',
        title: 'Add FAQ',
        why: 'Help & FAQ app shipped 2026-10-20 (help.html + help-data.js).'
    },
    {
        id: '-P4T_S0tmY0lEmuWZkG9',
        title: 'Update log',
        why: 'The changelog page (changelog.html) shipped 2026-10-22 and is linked from the home footer and Suggestions.'
    },
    {
        id: '-P--QqZ8luxJ622daYlC',
        title: 'app search so you can search apps',
        why: 'The dashboard app search shipped 2026-10-21 (index.html).'
    },
    {
        id: '-P2Z8GbuWZFk4GMPDDlx',
        title: 'we need more reactions',
        why: 'KindleChat reaction picker gained mad and wave reactions (laugh already existed) on 2026-10-24.'
    }
];

(async function main() {
    const root = admin.database().ref('suggestions');
    let changed = 0;
    let skipped = 0;

    for (const entry of SHIPPED) {
        const snap = await root.child(entry.id).once('value');
        const val = snap.val();
        if (!val) {
            console.log('SKIP missing   ' + entry.id + '  ' + entry.title);
            skipped++;
            continue;
        }
        if ((val.title || '') !== entry.title) {
            console.log('SKIP title     ' + entry.id + '  expected=' + JSON.stringify(entry.title) + ' actual=' + JSON.stringify(val.title));
            skipped++;
            continue;
        }
        if (val.status === 'done') {
            console.log('SKIP already   ' + entry.id + '  ' + entry.title);
            skipped++;
            continue;
        }
        console.log((APPLY ? 'DONE ' : 'WOULD DONE ') + entry.id + '  ' + entry.title + '  (' + entry.why + ')');
        if (APPLY) {
            await root.child(entry.id).update({ status: 'done' });
            changed++;
        }
    }

    console.log('\n' + (APPLY ? 'Applied to ' + changed : 'Dry run: would update ' + SHIPPED.length) + ' record(s); skipped ' + skipped + '.');
    if (!APPLY) console.log('Re-run with --apply to write.');
    process.exit(0);
})().catch(function (err) {
    console.error('Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
