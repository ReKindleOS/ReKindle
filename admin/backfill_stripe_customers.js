/*
 * Backfill missing Stripe references on `users/{uid}` from Checkout Sessions.
 *
 * WHY THIS EXISTS (2026-10-27)
 * The moderation console's Users tab shows the Stripe customer when
 * `users/{uid}.stripeCustomerId` exists, and a Checkout Session id when it does
 * not. Lifetime buyers had neither: Stripe creates a Customer for subscription
 * checkouts, but for `mode=payment` it does not unless the session asks for one
 * (`customer_creation=always`), so `session.customer` is `null` for lifetime
 * purchases. The webhook only writes the field when it is set, which is why 168
 * of the 171 lifetime buyers in the 2026-10-26 audit showed no Stripe reference
 * at all (e.g. `flamefencerplus`, `FzXS0W5zPHPXcbMnfa0C7c8mj8q2`, and
 * `ryguy248248`, `S5n8bf81aKdaLEejxw9POrZRRUx1`).
 *
 * Every completed Checkout Session does carry `client_reference_id` (the
 * Firebase uid, baked in by workers/rekindle-stripe/worker.js /create-checkout)
 * and its own `cs_...` id, and the session id opens the payment in the Stripe
 * dashboard. So:
 *   - sessions with a customer     -> users/{uid}.stripeCustomerId
 *   - sessions without a customer  -> users/{uid}.stripeCheckoutSessionId
 *
 * Run:
 *   STRIPE_KEY=rk_live_... node admin/backfill_stripe_customers.js                 # dry run
 *   STRIPE_KEY=rk_live_... node admin/backfill_stripe_customers.js --fix           # write
 *   STRIPE_KEY=rk_live_... node admin/backfill_stripe_customers.js --fix --only-uid=<uid>[,<uid>]
 *
 * Needs a restricted key with Checkout Sessions read (the same key
 * `admin/audit_pro_entitlements.js` uses).
 *
 * Safety rules:
 *   - read-only unless `--fix` is passed;
 *   - only fills an empty field, never overwrites an existing value, and never
 *     guesses between two customer ids (reported as a conflict);
 *   - never creates a user document unless `--create-docs` is passed on purpose;
 *   - writes a CSV of the plan to admin/backups/ every run, dry run included.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = process.argv.indexOf('--fix') !== -1;
const CREATE_DOCS = process.argv.indexOf('--create-docs') !== -1;
const ONLY_ARG = process.argv.filter(function (arg) { return arg.indexOf('--only-uid=') === 0; })[0];
const ONLY_UIDS = ONLY_ARG
    ? ONLY_ARG.slice('--only-uid='.length).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    : null;
const OUT_CSV = path.join(
    ROOT,
    'admin',
    'backups',
    'stripe-customers-backfill-' + new Date().toISOString().slice(0, 10) + '.csv'
);

/* -------------------------------------------------------------------------- */
/* Pure planning (unit tested in scripts/test-backfill-stripe-customers.js)    */
/* -------------------------------------------------------------------------- */

/** `session.customer` is a string, but it can be an expanded object. */
function customerIdOf(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.id === 'string') return value.id;
    return '';
}

/**
 * Pick the sessions we can trust out of raw Stripe Checkout Sessions.
 * Returns [{ uid, customer, sessionId, mode, created, email }]; `customer` is
 * empty for payment-mode sessions, which Stripe does not attach a Customer to.
 */
function collectCustomerLinks(sessions) {
    const out = [];
    (sessions || []).forEach(function (session) {
        if (!session) return;
        const uid = session.client_reference_id;
        if (!uid) return;
        const customer = customerIdOf(session.customer);
        const sessionId = typeof session.id === 'string' ? session.id : '';
        if (!customer && !sessionId) return;
        // `complete` sessions can still be unpaid (failed card); only a paid /
        // no-payment-required session proves the link.
        const status = session.payment_status;
        if (status && status !== 'paid' && status !== 'no_payment_required') return;
        out.push({
            uid: uid,
            customer: customer,
            sessionId: sessionId,
            mode: session.mode || '',
            created: typeof session.created === 'number' ? session.created : 0,
            email: (session.customer_details && session.customer_details.email) || ''
        });
    });
    return out;
}

/**
 * Compare the Stripe sessions with the current user documents.
 *
 * `docs` is a plain object: uid -> { stripeCustomerId, stripeCheckoutSessionId }
 * for documents that exist; a uid missing from it has no document at all.
 *
 * Returns { updates, skipped, conflicts }. Each update is
 * { uid, field, value, sessionId, mode, created, current, create }, sorted
 * newest session first.
 */
function planBackfill(links, docs, opts) {
    const createDocs = !!(opts && opts.createDocs !== undefined ? opts.createDocs : CREATE_DOCS);
    const byUid = new Map();
    (links || []).forEach(function (link) {
        let entry = byUid.get(link.uid);
        if (!entry) {
            entry = { uid: link.uid, customers: [], sessions: [] };
            byUid.set(link.uid, entry);
        }
        if (link.customer && entry.customers.indexOf(link.customer) === -1) entry.customers.push(link.customer);
        entry.sessions.push(link);
    });

    const updates = [];
    const skipped = [];
    const conflicts = [];

    byUid.forEach(function (entry) {
        const uid = entry.uid;
        const sessions = entry.sessions.slice().sort(function (a, b) { return b.created - a.created; });
        const newest = sessions[0];
        const doc = docs ? docs[uid] : undefined;

        if (!doc) {
            skipped.push({ uid: uid, action: createDocs ? 'create-doc' : 'no-user-doc', customers: entry.customers.slice() });
            if (createDocs) {
                const useCustomer = entry.customers.length === 1;
                updates.push({
                    uid: uid,
                    field: useCustomer ? 'stripeCustomerId' : 'stripeCheckoutSessionId',
                    value: useCustomer ? newest.customer : newest.sessionId,
                    sessionId: newest.sessionId,
                    mode: newest.mode,
                    created: newest.created,
                    current: '',
                    create: true
                });
            }
            return;
        }

        const currentCustomer = String(doc.stripeCustomerId || '');

        if (entry.customers.length > 1) {
            conflicts.push({ uid: uid, action: 'multiple-customers', current: currentCustomer, stripe: entry.customers.slice() });
            return;
        }

        if (entry.customers.length === 1) {
            const customer = entry.customers[0];
            if (currentCustomer && currentCustomer !== customer) {
                conflicts.push({ uid: uid, action: 'different-customer', current: currentCustomer, stripe: [customer] });
                return;
            }
            if (currentCustomer === customer) {
                skipped.push({ uid: uid, action: 'already-linked', current: currentCustomer });
                return;
            }
            updates.push({
                uid: uid,
                field: 'stripeCustomerId',
                value: customer,
                sessionId: newest.sessionId,
                mode: newest.mode,
                created: newest.created,
                current: '',
                create: false
            });
            return;
        }

        // No Stripe Customer on any session: keep the Checkout Session id instead.
        if (currentCustomer) {
            skipped.push({ uid: uid, action: 'has-customer', current: currentCustomer });
            return;
        }
        const currentSession = String(doc.stripeCheckoutSessionId || '');
        if (currentSession === newest.sessionId) {
            skipped.push({ uid: uid, action: 'already-linked-session', current: currentSession });
            return;
        }
        if (currentSession) {
            conflicts.push({ uid: uid, action: 'different-session', current: currentSession, stripe: [newest.sessionId] });
            return;
        }
        updates.push({
            uid: uid,
            field: 'stripeCheckoutSessionId',
            value: newest.sessionId,
            sessionId: newest.sessionId,
            mode: newest.mode,
            created: newest.created,
            current: '',
            create: false
        });
    });

    updates.sort(function (a, b) { return b.created - a.created; });
    return { updates: updates, skipped: skipped, conflicts: conflicts };
}

/* -------------------------------------------------------------------------- */
/* Stripe                                                                      */
/* -------------------------------------------------------------------------- */

async function stripePage(pathname, params) {
    const out = [];
    let after = null;
    // STRIPE_API_BASE is a testing seam (a local mock server); production uses Stripe.
    const base = process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1';
    for (;;) {
        const url = new URL(base + pathname);
        url.searchParams.set('limit', '100');
        Object.keys(params || {}).forEach(function (key) { url.searchParams.set(key, params[key]); });
        if (after) url.searchParams.set('starting_after', after);
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.STRIPE_KEY } });
        if (!res.ok) {
            const body = await res.text();
            throw new Error('Stripe ' + res.status + ' ' + pathname + ': ' + body.slice(0, 260));
        }
        const data = await res.json();
        const rows = data.data || [];
        out.push.apply(out, rows);
        if (!data.has_more || rows.length === 0) break;
        after = rows[rows.length - 1].id;
    }
    return out;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function maskEmail(email) {
    if (!email) return '';
    const at = String(email).indexOf('@');
    if (at < 1) return '***';
    return email.slice(0, 1) + '***' + email.slice(at);
}

function csvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeCsv(rows) {
    const header = ['action', 'field', 'value', 'uid', 'email', 'session_id', 'mode', 'session_created', 'existing_value'];
    const lines = [header.join(',')];
    rows.forEach(function (row) {
        lines.push(header.map(function (key) { return csvCell(row[key]); }).join(','));
    });
    fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
    fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n');
}

async function loadDocs(db, uids) {
    const docs = {};
    for (let i = 0; i < uids.length; i += 300) {
        const chunk = uids.slice(i, i + 300);
        const snaps = await db.getAll.apply(db, chunk.map(function (uid) { return db.collection('users').doc(uid); }));
        snaps.forEach(function (snap) {
            if (snap.exists) docs[snap.id] = snap.data() || {};
        });
    }
    return docs;
}

async function loadEmails(auth, uids) {
    const emails = {};
    for (let i = 0; i < uids.length; i += 100) {
        const chunk = uids.slice(i, i + 100);
        try {
            const result = await auth.getUsers(chunk.map(function (uid) { return { uid: uid }; }));
            (result.users || []).forEach(function (user) { if (user.email) emails[user.uid] = user.email; });
        } catch (e) {
            console.warn('warning: could not read emails for a batch of uids:', e.message);
        }
    }
    return emails;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
    if (!process.env.STRIPE_KEY) {
        console.error('Missing STRIPE_KEY. Use a restricted key with Checkout Sessions read access.');
        process.exit(2);
    }
    if (!fs.existsSync(path.join(ROOT, 'service-account.json'))) {
        console.error('Missing service-account.json');
        process.exit(2);
    }

    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(require(path.join(ROOT, 'service-account.json'))) });
    const db = admin.firestore();
    const auth = admin.auth();

    console.log('Reading completed Checkout Sessions from Stripe...');
    const sessions = await stripePage('/checkout/sessions', { status: 'complete' });
    let links = collectCustomerLinks(sessions);
    const totalSessions = sessions.length;
    const unmapped = totalSessions - links.length;
    const withCustomer = links.filter(function (link) { return !!link.customer; }).length;
    if (ONLY_UIDS) {
        links = links.filter(function (link) { return ONLY_UIDS.indexOf(link.uid) !== -1; });
    }
    const uids = [];
    links.forEach(function (link) { if (uids.indexOf(link.uid) === -1) uids.push(link.uid); });
    console.log('  ' + totalSessions + ' sessions, ' + links.length + ' linkable (' + withCustomer
        + ' with a Stripe customer, ' + unmapped + ' without a uid or payment), ' + uids.length + ' distinct uids');

    const docs = await loadDocs(db, uids);
    const plan = planBackfill(links, docs);
    const emails = await loadEmails(auth, plan.updates.map(function (row) { return row.uid; }));

    const csvRows = plan.updates.map(function (row) {
        return {
            action: row.create ? 'create-doc' : 'update',
            field: row.field,
            value: row.value,
            uid: row.uid,
            email: maskEmail(emails[row.uid]),
            session_id: row.sessionId,
            mode: row.mode,
            session_created: row.created ? new Date(row.created * 1000).toISOString() : '',
            existing_value: row.current
        };
    });
    plan.conflicts.forEach(function (row) {
        csvRows.push({
            action: 'conflict-' + row.action,
            field: '',
            value: row.stripe.join(' '),
            uid: row.uid,
            email: maskEmail(emails[row.uid]),
            session_id: '',
            mode: '',
            session_created: '',
            existing_value: row.current
        });
    });
    plan.skipped.filter(function (row) { return row.action === 'no-user-doc'; }).forEach(function (row) {
        csvRows.push({
            action: 'skipped-no-user-doc',
            field: '',
            value: row.customers.join(' '),
            uid: row.uid,
            email: maskEmail(emails[row.uid]),
            session_id: '',
            mode: '',
            session_created: '',
            existing_value: ''
        });
    });
    writeCsv(csvRows);

    console.log('');
    console.log('To link: ' + plan.updates.length);
    plan.updates.slice(0, 25).forEach(function (row) {
        console.log('  ' + row.uid + '  ' + row.field + '=' + row.value + '  (' + (row.mode || 'mode?') + ', '
            + (row.created ? new Date(row.created * 1000).toISOString().slice(0, 10) : 'date?') + ')');
    });
    if (plan.updates.length > 25) console.log('  ... ' + (plan.updates.length - 25) + ' more (see CSV)');

    const docless = plan.skipped.filter(function (row) { return row.action === 'no-user-doc' || row.action === 'create-doc'; }).length;
    const linked = plan.skipped.filter(function (row) { return row.action === 'already-linked' || row.action === 'already-linked-session'; }).length;
    console.log('Already linked: ' + linked);
    console.log('No user document: ' + docless + (CREATE_DOCS ? ' (will be created)' : ' (skipped - pass --create-docs to create them)'));
    console.log('Conflicts: ' + plan.conflicts.length);
    plan.conflicts.forEach(function (row) {
        console.log('  ' + row.action + '  ' + row.uid + '  existing=' + (row.current || '-') + '  stripe=' + row.stripe.join(','));
    });
    console.log('CSV: ' + path.relative(ROOT, OUT_CSV));

    if (!FIX) {
        console.log('');
        console.log('Dry run. Re-run with --fix to write ' + plan.updates.length + ' Stripe reference field(s).');
        return 0;
    }

    console.log('');
    console.log('Writing...');
    let written = 0;
    let failed = 0;
    for (const row of plan.updates) {
        const patch = {};
        patch[row.field] = row.value;
        try {
            await db.collection('users').doc(row.uid).set(patch, { merge: true });
            written++;
        } catch (e) {
            failed++;
            console.error('  [ERR] ' + row.uid + ': ' + e.message);
        }
    }
    console.log('Done. Written: ' + written + '  Errors: ' + failed);
    return failed ? 1 : 0;
}

if (require.main === module) {
    main().then(function (code) {
        process.exitCode = code || 0;
    }).catch(function (err) {
        console.error(err && err.stack ? err.stack : err);
        process.exitCode = 1;
    });
}

module.exports = { customerIdOf: customerIdOf, collectCustomerLinks: collectCustomerLinks, planBackfill: planBackfill };
