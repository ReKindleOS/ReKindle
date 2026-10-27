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
    },
    // Sweep 2 - 2026-10-24 evening (after 9091c88's own sweep).
    {
        id: '-OxvIdfe-PjCiChFpliq',
        title: 'cant connect',
        why: 'Pinterest connections now sync through users/{uid}/pro_data/pinterest, so a phone/PC connection works on Kindle, and Kindle users get a connect-elsewhere hint (651b123, 2026-10-24).'
    },
    // Note: the "KindleChat error" report (-P4bTr1y4HEjFkn8j10I) covering the
    // same late-auth guest overlay was deleted from the board while this sweep
    // ran, so there is nothing left to mark. The fix is the same 9091c88
    // change described above.
    {
        id: '-P4feLBiofRbpS5f9KSL',
        title: 'FAQ in suggestions',
        why: 'The Suggestions board gained a triage strip linking the Help FAQ, changelog and billing/refund answers, and Help gained the paid-but-Pro-missing/refund FAQ (9091c88, 2026-10-24).'
    },
    {
        id: '-OyumHhfjFTnq0CwPmvu',
        title: 'CAN YOU PLEASE ADD ALT TEXT TO PIXEL ART?',
        why: 'The pixel-art post dialog gained an optional caption that is shown with the art and used as the image alt text in KindleChat (9091c88, 2026-10-24).'
    },
    // Sweep 3 - 2026-10-25 1027 outage (KindleChat "Load failed").
    // The account hit the Workers Free 100k/day limit, every worker returned the
    // CORS-less "error code: 1027" page, and the client surfaced the raw
    // TypeError once per send. The middleware removal + preflight cache keep the
    // account under the cap; the client now shows one outage message per two
    // minutes. See docs/agent/usage-limits.md.
    {
        id: '-P4hSc35dDUqJf_9FGgb',
        title: 'Failed To fetch',
        why: 'The 2026-10-25 1027 outage: KindleChat now recognises a transport failure or a non-JSON 429/5xx and shows one clear "temporarily unavailable" message instead of the raw "Failed to fetch"; the Pages middleware removal and the Workers\' Access-Control-Max-Age preflight cache keep the account under the 100k/day Free limit.'
    },
    {
        id: '-P4htMUDUJx4Z1KzGXG9',
        title: 'Remove the alerts in Neighborhood, Topics and KindleChat',
        why: 'Sending during the 2026-10-25 quota outage no longer pops an alert on every attempt: KindleChat keeps the typed message and shows one message per two-minute cooldown, and Neighbourhood/Topics use js/worker-client.js for the same friendly error. Normal posting has no alert.'
    },
    // Sweep 4 - 2026-10-27, after 24ee67a deployed (Pages + moderation Worker).
    // These are the rows docs/agent/backlog.md listed as "close after this pass
    // deploys". Verified live: /maze serves Easy/Normal/Hard, /theme.js contains
    // __rkAuthBusy, and /js/translate-client.js?v=3 is served.
    {
        id: '-P1xxX2H-mw7CdAYDxzA',
        title: 'Translate broken',
        why: 'Translation moved into the browser via js/translate-client.js (MyMemory with LibreTranslate fallback) on 2026-10-26, so the Translate app, KindleChat and Neighbourhood no longer depend on the dead gtx/lingva endpoints.'
    },
    {
        id: '-P2U4lIHw8RpXTXIQbLZ',
        title: 'please i cant even sign in',
        why: 'The 2026-10-26 sign-in fix: theme.js skips the service-worker controllerchange reload while signing in, the session is pinned with setPersistence(LOCAL) before auth, and an unexpected sign-out now prompts instead of silently dropping the session (live theme.js carries __rkAuthBusy).'
    },
    {
        id: '-P4dTra4d9ZuCcP0Ixv7',
        title: 'sign in glitch',
        why: 'Same 2026-10-26 sign-in fix set as "please i cant even sign in" - the post-login reload that flashed the profile and then showed the guest state no longer fires.'
    },
    {
        id: '-P2aNV3zhT7mk3KCEaPi',
        title: 'PEOPLE KEEP SPAM REPORTING',
        why: 'Since 2026-10-26 a single report no longer deletes chat/comment/DM content on its own: it is removed only when moderation confirms it or a second, different person reports it, and report misuse is still rate-limited in the worker.'
    },
    {
        id: '-Oy5K55IArk3Qy-aJbyZ',
        title: 'Report Function',
        why: 'Reported content is now re-checked instead of removed instantly (2026-10-26): one report holds the content for review unless moderation confirms it, exactly as this row asked.'
    },
    {
        id: '-P4qSoQgU0ysrQuJRqZO',
        title: 'make the mazes harder',
        why: 'Maze gained Easy / Normal / Hard difficulty levels on 2026-10-26 (maze.html, deployed at /maze).'
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
        }
        changed++;
    }

    console.log('\n' + (APPLY ? 'Applied to ' + changed : 'Dry run: would update ' + changed) + ' record(s); skipped ' + skipped + '.');
    if (!APPLY) console.log('Re-run with --apply to write.');
    process.exit(0);
})().catch(function (err) {
    console.error('Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
