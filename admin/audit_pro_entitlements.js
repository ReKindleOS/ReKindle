/*
 * READ-ONLY Pro entitlement audit.
 *
 * Answers: who has effective ReKindle+ access but no visible payment evidence?
 * It never writes to Firestore, Stripe or Auth. Manual grants are expected; the
 * report separates them from the cases worth reviewing.
 *
 * Run:
 *   STRIPE_KEY=rk_live_... node admin/audit_pro_entitlements.js
 *
 * Requires Events/Subscriptions/Checkout Sessions read on the restricted key.
 * Writes a CSV to admin/backups/ and prints a summary. Use --json for the full
 * machine-readable report.
 *
 * Classification:
 *   paid-active              active or trialing Stripe subscription
 *   paid-lifetime            completed Stripe Checkout Session in payment mode
 *   manual                   subscriptionType === "manual" (admin grant)
 *   lifetime-comp            subscriptionType === "lifetime", no Stripe payment found
 *   supporter-comp           no user expiry, but a future config/supporters entry
 *   recurring-no-active-sub  Pro + Stripe customer, but no active/trialing sub
 *   no-payment-evidence      Pro with no customer, no manual/lifetime type, no supporter
 *   past-due-still-pro      past_due/unpaid subscription while Pro is still active
 *   stale-isPro              isPro true but proExpiresAt is in the past (not effective)
 *   stale-claim              pro=true custom claim but no effective Firestore Pro
 *   supporter-only           future config/supporters entry with no effective user doc
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = path.join(__dirname, '..');
const DAY = 86400;
const NOW = Date.now();
const JSON_OUT = process.argv.includes('--json');
const OUT_CSV = path.join(ROOT, 'admin', 'backups', 'pro-entitlement-audit-' + new Date().toISOString().slice(0, 10) + '.csv');

if (!fs.existsSync(path.join(ROOT, 'service-account.json'))) {
    console.error('Missing service-account.json');
    process.exit(2);
}
if (!process.env.STRIPE_KEY) {
    console.error('Missing STRIPE_KEY. Use a restricted read-only key.');
    process.exit(2);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(ROOT, 'service-account.json'))) });
const db = admin.firestore();
const auth = admin.auth();

function log() {
    if (!JSON_OUT) console.log.apply(console, arguments);
}
function msOf(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    return new Date(value).getTime();
}
function iso(ms) {
    return ms ? new Date(ms).toISOString() : '—';
}
function maskEmail(email) {
    if (!email) return '—';
    const at = String(email).indexOf('@');
    if (at < 1) return '***';
    return email.slice(0, 1) + '***' + email.slice(at);
}

async function stripePage(pathname, params) {
    const out = [];
    let after = null;
    for (;;) {
        const url = new URL('https://api.stripe.com/v1' + pathname);
        url.searchParams.set('limit', '100');
        Object.keys(params || {}).forEach(function (k) { url.searchParams.set(k, params[k]); });
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

async function main() {
    const report = {
        generatedAt: new Date().toISOString(),
        effectivePro: 0,
        byClassification: {},
        review: [],
        staleIsPro: [],
        staleClaims: [],
        supporterOnly: []
    };

    // ------------------------------------------------------------------
    // 1. Auth: emails + custom claims (also serves as the supporter index).
    // ------------------------------------------------------------------
    log('Scanning Auth users for emails/claims...');
    const authByUid = new Map();
    let authPage = await auth.listUsers(1000);
    for (;;) {
        authPage.users.forEach(function (u) {
            authByUid.set(u.uid, { email: u.email || '', claims: u.customClaims || {} });
        });
        if (!authPage.pageToken) break;
        authPage = await auth.listUsers(1000, authPage.pageToken);
    }
    const emailToUid = new Map();
    authByUid.forEach(function (a, uid) {
        if (a.email) emailToUid.set(a.email.toLowerCase(), uid);
    });
    log('  ' + authByUid.size + ' Auth users');

    // ------------------------------------------------------------------
    // 2. Firestore: every doc that could be Pro (future expiry, isPro flag,
    //    Stripe link, manual/lifetime type).
    // ------------------------------------------------------------------
    log('Reading Firestore Pro candidates...');
    const docs = new Map();
    const snapshots = [];
    snapshots.push(await db.collection('users').where('proExpiresAt', '>', admin.firestore.Timestamp.now()).get());
    snapshots.push(await db.collection('users').where('isPro', '==', true).get());
    snapshots.push(await db.collection('users').where('stripeCustomerId', '>', '').get());
    snapshots.push(await db.collection('users').where('subscriptionType', '==', 'manual').get());
    snapshots.push(await db.collection('users').where('subscriptionType', '==', 'lifetime').get());
    snapshots.forEach(function (snap) {
        snap.forEach(function (d) { docs.set(d.id, { id: d.id, data: d.data() || {} }); });
    });
    log('  ' + docs.size + ' candidate documents');

    const effective = new Map();
    const staleIsPro = new Map();
    docs.forEach(function (row) {
        const expiry = msOf(row.data.proExpiresAt);
        row.expiry = expiry;
        if (expiry > NOW) effective.set(row.id, row);
        else if (row.data.isPro === true) staleIsPro.set(row.id, row);
    });

    // ------------------------------------------------------------------
    // 3. Supporters + payment evidence.
    // ------------------------------------------------------------------
    const supportersSnap = await db.doc('config/supporters').get();
    const supporters = supportersSnap.exists ? (supportersSnap.data() || {}) : {};
    const supporterByUid = new Map();
    Object.keys(supporters).forEach(function (email) {
        const entry = supporters[email];
        const exp = entry && msOf(entry.expiresAt);
        if (!(exp > NOW)) return;
        const uid = emailToUid.get(email.toLowerCase());
        if (uid) supporterByUid.set(uid, { email: email, expiresAt: exp, isLifetime: !!entry.isLifetime });
    });

    log('Reading Stripe payment evidence...');
    const activeByCustomer = new Map();
    const pastDueByCustomer = new Map();
    const lifetimeCustomers = new Set();
    const lifetimeUids = new Set();

    for (const status of ['active', 'trialing']) {
        const subs = await stripePage('/subscriptions', { status: status });
        subs.forEach(function (sub) {
            const customer = typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id);
            if (!customer) return;
            if (!activeByCustomer.has(customer)) activeByCustomer.set(customer, []);
            activeByCustomer.get(customer).push(sub);
        });
    }
    for (const status of ['past_due', 'unpaid']) {
        const subs = await stripePage('/subscriptions', { status: status });
        subs.forEach(function (sub) {
            const customer = typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id);
            if (customer) pastDueByCustomer.set(customer, sub);
        });
    }
    const sessions = await stripePage('/checkout/sessions', { status: 'complete' });
    sessions.forEach(function (session) {
        if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
        if (session.customer) lifetimeCustomers.add(typeof session.customer === 'string' ? session.customer : session.customer.id);
        if (session.client_reference_id) lifetimeUids.add(session.client_reference_id);
    });
    log('  ' + activeByCustomer.size + ' customers with active/trialing subs, ' + lifetimeUids.size + ' lifetime checkout uids');

    // ------------------------------------------------------------------
    // 4. Classify every effective Pro user.
    // ------------------------------------------------------------------
    function classify(row) {
        const type = row.data.subscriptionType || '';
        const customer = row.data.stripeCustomerId || '';
        const active = customer ? activeByCustomer.get(customer) : null;
        const past = customer ? pastDueByCustomer.get(customer) : null;
        const lifetime = (customer && lifetimeCustomers.has(customer)) || lifetimeUids.has(row.id);
        if (active && active.length) return 'paid-active';
        if (lifetime) return 'paid-lifetime';
        if (past) return 'past-due-still-pro';
        if (type === 'manual') return 'manual';
        if (type === 'lifetime') return 'lifetime-comp';
        if (customer) return 'recurring-no-active-sub';
        if (supporterByUid.has(row.id)) return 'supporter-comp';
        return 'no-payment-evidence';
    }

    const rows = [];
    effective.forEach(function (row) {
        const classification = classify(row);
        report.effectivePro++;
        report.byClassification[classification] = (report.byClassification[classification] || 0) + 1;
        const email = authByUid.has(row.id) ? authByUid.get(row.id).email : '';
        const claimPro = authByUid.has(row.id) ? authByUid.get(row.id).claims.pro === true : false;
        const out = {
            source: 'firestore',
            uid: row.id,
            emailMasked: maskEmail(email),
            stripeCustomerId: row.data.stripeCustomerId || '',
            subscriptionType: row.data.subscriptionType || '',
            proExpiresAt: iso(row.expiry),
            isPro: row.data.isPro === true,
            classification: classification,
            hasActiveSub: !!(row.data.stripeCustomerId && activeByCustomer.get(row.data.stripeCustomerId)),
            pastDue: !!(row.data.stripeCustomerId && pastDueByCustomer.has(row.data.stripeCustomerId)),
            lifetimePaid: (row.data.stripeCustomerId && lifetimeCustomers.has(row.data.stripeCustomerId)) || lifetimeUids.has(row.id),
            supporter: supporterByUid.has(row.id),
            claimPro: claimPro
        };
        rows.push(out);
        if (['recurring-no-active-sub', 'no-payment-evidence', 'past-due-still-pro', 'lifetime-comp', 'supporter-comp'].indexOf(classification) !== -1) {
            report.review.push(out);
        }
    });

    // ------------------------------------------------------------------
    // 5. Stale isPro flags and stale claims.
    // ------------------------------------------------------------------
    staleIsPro.forEach(function (row) {
        report.staleIsPro.push({
            uid: row.id,
            emailMasked: maskEmail(authByUid.has(row.id) ? authByUid.get(row.id).email : ''),
            subscriptionType: row.data.subscriptionType || '',
            proExpiresAt: iso(row.expiry),
            stripeCustomerId: row.data.stripeCustomerId || ''
        });
    });

    authByUid.forEach(function (a, uid) {
        if (a.claims.pro !== true) return;
        if (effective.has(uid)) return;
        report.staleClaims.push({ uid: uid, emailMasked: maskEmail(a.email), proExpiresAt: docs.has(uid) ? iso(msOf(docs.get(uid).data.proExpiresAt)) : 'no user doc' });
    });

    // ------------------------------------------------------------------
    // 6. Supporter-only entries (no effective user Pro).
    // ------------------------------------------------------------------
    Object.keys(supporters).forEach(function (email) {
        const entry = supporters[email];
        const exp = entry && msOf(entry.expiresAt);
        if (!(exp > NOW)) return;
        const uid = emailToUid.get(email.toLowerCase());
        if (!uid || effective.has(uid)) return;
        report.supporterOnly.push({
            uid: uid,
            emailMasked: maskEmail(email),
            expiresAt: iso(exp),
            isLifetime: !!entry.isLifetime,
            userDoc: docs.has(uid) ? 'exists' : 'missing'
        });
    });

    report.staleIsPro = report.staleIsPro;
    report.staleClaims.sort(function (a, b) { return a.uid.localeCompare(b.uid); });

    // ------------------------------------------------------------------
    // 7. Report + CSV.
    // ------------------------------------------------------------------
    if (JSON_OUT) {
        report.rows = rows;
        console.log(JSON.stringify(report, null, 2));
    } else {
        log('');
        log('Effective Pro users: ' + report.effectivePro);
        Object.keys(report.byClassification).sort().forEach(function (k) {
            log('  ' + k + ': ' + report.byClassification[k]);
        });
        log('');
        log('Review categories (read-only):');
        report.review.forEach(function (r) {
            log('  ' + r.classification + '  uid=' + r.uid.slice(0, 8) + '…  type=' + (r.subscriptionType || '—') +
                '  exp=' + r.proExpiresAt + '  customer=' + (r.stripeCustomerId ? r.stripeCustomerId.slice(0, 10) + '…' : '—') +
                '  email=' + r.emailMasked + '  claim=' + r.claimPro);
        });
        log('');
        log('Manual grants (expected): ' + (report.byClassification.manual || 0));
        rows.filter(function (r) { return r.classification === 'manual'; }).forEach(function (r) {
            log('  uid=' + r.uid.slice(0, 8) + '…  exp=' + r.proExpiresAt + '  email=' + r.emailMasked);
        });
        log('');
        log('Stale isPro flags (expired, not effective): ' + report.staleIsPro.length);
        report.staleIsPro.slice(0, 30).forEach(function (r) { log('  ' + r.uid.slice(0, 8) + '…  exp=' + r.proExpiresAt + '  type=' + (r.subscriptionType || '—')); });
        log('');
        log('Supporter-only (future supporters entry, no effective user Pro): ' + report.supporterOnly.length);
        report.supporterOnly.forEach(function (r) { log('  ' + (r.uid ? r.uid.slice(0, 8) + '…' : 'no uid') + '  doc=' + r.userDoc + '  exp=' + r.expiresAt + '  email=' + r.emailMasked); });
        log('');
        log('Stale pro claims (claim true, no effective Firestore Pro): ' + report.staleClaims.length);
        report.staleClaims.slice(0, 30).forEach(function (r) { log('  ' + r.uid.slice(0, 8) + '…  exp=' + r.proExpiresAt + '  email=' + r.emailMasked); });
    }

    const header = ['source', 'uid', 'emailMasked', 'stripeCustomerId', 'subscriptionType', 'proExpiresAt', 'isPro', 'classification', 'hasActiveSub', 'pastDue', 'lifetimePaid', 'supporter', 'claimPro'];
    const lines = [header.join(',')];
    rows.forEach(function (r) { lines.push(header.map(function (k) { return String(r[k] == null ? '' : r[k]).replace(/,/g, ';'); }).join(',')); });
    report.staleIsPro.forEach(function (r) {
        lines.push(['stale-isPro', r.uid, r.emailMasked, r.stripeCustomerId, r.subscriptionType, r.proExpiresAt, 'true', 'stale-isPro', '', '', '', '', ''].join(','));
    });
    report.staleClaims.forEach(function (r) {
        lines.push(['stale-claim', r.uid, r.emailMasked, '', '', r.proExpiresAt, '', 'stale-claim', '', '', '', '', 'true'].join(','));
    });
    report.supporterOnly.forEach(function (r) {
        lines.push(['supporter-only', r.uid || '', r.emailMasked, '', '', r.expiresAt, '', 'supporter-only', '', '', '', 'true', ''].join(','));
    });
    fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
    fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n');
    log('');
    log('CSV: ' + OUT_CSV);
    process.exit(0);
}

main().catch(function (err) {
    console.error('Audit failed:', err.message);
    process.exit(2);
});
