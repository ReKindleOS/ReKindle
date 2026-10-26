/*
 * Export full contact emails for the Pro audits. READ-ONLY against Stripe,
 * Firestore and Auth; writes local CSVs under admin/backups/ only.
 *
 * Auth emails on ReKindle are synthetic ({username}@rekindle.ink). The real
 * billing email lives on the Stripe customer or the Checkout Session, so
 * `contact_email` prefers those and falls back to the Firestore/Auth address.
 *
 * Run:
 *   STRIPE_KEY=rk_live_... node admin/export_pro_emails.js
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'admin', 'backups');
const AUDIT = path.join(BACKUPS, 'pro-entitlement-audit-2026-10-26.csv');
const REPAIR = path.join(BACKUPS, 'stripe-pro-repair-2026-10-26.csv');

if (!process.env.STRIPE_KEY) {
    console.error('Missing STRIPE_KEY.');
    process.exit(2);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(ROOT, 'service-account.json'))) });
const db = admin.firestore();
const auth = admin.auth();

function parseCsv(file) {
    const text = fs.readFileSync(file, 'utf8').trim();
    const lines = text.split('\n');
    const header = lines.shift().split(',');
    return lines.map(function (line) { return line.split(','); }).filter(function (r) { return r.length === header.length; });
}
function cell(value) {
    const s = String(value == null ? '' : value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
    const lines = [header.map(cell).join(',')];
    rows.forEach(function (r) { lines.push(header.map(function (k) { return cell(r[k]); }).join(',')); });
    fs.writeFileSync(file, lines.join('\n') + '\n');
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
            throw new Error('Stripe ' + res.status + ' ' + pathname + ': ' + body.slice(0, 240));
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
    const auditHeader = ['source', 'uid', 'emailMasked', 'stripeCustomerId', 'subscriptionType', 'proExpiresAt', 'isPro', 'classification', 'hasActiveSub', 'pastDue', 'lifetimePaid', 'supporter', 'claimPro'];
    const audit = parseCsv(AUDIT).map(function (r) {
        const o = {};
        auditHeader.forEach(function (k, i) { o[k] = r[i]; });
        return o;
    });
    const repairHeader = ['uid', 'stripeCustomerId', 'new_proExpiresAt', 'reason'];
    const repair = parseCsv(REPAIR).map(function (r) {
        const o = {};
        repairHeader.forEach(function (k, i) { o[k] = r[i]; });
        return o;
    });

    const uids = Array.from(new Set(audit.map(function (r) { return r.uid; }).concat(repair.map(function (r) { return r.uid; }))));
    console.log('Exporting emails for', uids.length, 'uids...');

    const customers = new Set();
    audit.forEach(function (r) { if (r.stripeCustomerId) customers.add(r.stripeCustomerId); });
    repair.forEach(function (r) { if (r.stripeCustomerId) customers.add(r.stripeCustomerId); });

    const customerCache = new Map();
    for (const id of customers) {
        try {
            const res = await fetch('https://api.stripe.com/v1/customers/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + process.env.STRIPE_KEY } });
            if (res.ok) {
                const c = await res.json();
                customerCache.set(id, { email: c.email || '', name: c.name || '' });
            } else {
                customerCache.set(id, { email: '', name: '' });
            }
        } catch (e) {
            customerCache.set(id, { email: '', name: '' });
        }
    }

    const checkoutByUid = new Map();
    const checkoutByCustomer = new Map();
    const sessions = await stripePage('/checkout/sessions', { status: 'complete' });
    sessions.forEach(function (session) {
        const details = session.customer_details || {};
        const email = details.email || '';
        const name = details.name || '';
        if (session.client_reference_id && email) checkoutByUid.set(session.client_reference_id, { email: email, name: name });
        const customer = typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id);
        if (customer && email) checkoutByCustomer.set(customer, { email: email, name: name });
    });

    const rows = [];
    let real = 0, synthetic = 0;
    for (const uid of uids) {
        let authEmail = '', claimPro = false;
        try {
            const u = await auth.getUser(uid);
            authEmail = u.email || '';
            claimPro = !!(u.customClaims && u.customClaims.pro === true);
        } catch (e) { /* deleted Auth user */ }
        let fd = {};
        try {
            const snap = await db.doc('users/' + uid).get();
            if (snap.exists) fd = snap.data() || {};
        } catch (e) { /* ignore */ }
        const customerId = fd.stripeCustomerId || (audit.find(function (r) { return r.uid === uid; }) || {}).stripeCustomerId || (repair.find(function (r) { return r.uid === uid; }) || {}).stripeCustomerId || '';
        const cust = customerId ? customerCache.get(customerId) : null;
        const checkout = checkoutByUid.get(uid) || (customerId ? checkoutByCustomer.get(customerId) : null);
        const firestoreEmail = fd.email || '';
        let contact = '', source = '';
        if (cust && cust.email) { contact = cust.email; source = 'stripe_customer'; }
        else if (checkout && checkout.email) { contact = checkout.email; source = 'checkout_session'; }
        else if (firestoreEmail) { contact = firestoreEmail; source = 'firestore'; }
        else if (authEmail) { contact = authEmail; source = 'auth_synthetic'; }
        if (source === 'auth_synthetic') synthetic++; else real++;
        rows.push({
            source: (audit.find(function (r) { return r.uid === uid; }) || {}).classification || (repair.find(function (r) { return r.uid === uid; }) || {}).reason || '',
            uid: uid,
            classification: (audit.find(function (r) { return r.uid === uid; }) || {}).classification || '',
            subscriptionType: fd.subscriptionType || (audit.find(function (r) { return r.uid === uid; }) || {}).subscriptionType || '',
            proExpiresAt: fd.proExpiresAt ? (fd.proExpiresAt.toDate ? fd.proExpiresAt.toDate().toISOString() : String(fd.proExpiresAt)) : ((audit.find(function (r) { return r.uid === uid; }) || {}).proExpiresAt || (repair.find(function (r) { return r.uid === uid; }) || {}).new_proExpiresAt || ''),
            stripeCustomerId: customerId,
            contact_email: contact,
            email_source: source,
            auth_email: authEmail,
            stripe_email: cust ? cust.email : '',
            checkout_email: checkout ? checkout.email : '',
            customer_name: (cust && cust.name) || (checkout && checkout.name) || fd.displayName || '',
            claimPro: claimPro,
            hasActiveSub: (audit.find(function (r) { return r.uid === uid; }) || {}).hasActiveSub || '',
            pastDue: (audit.find(function (r) { return r.uid === uid; }) || {}).pastDue || '',
            lifetimePaid: (audit.find(function (r) { return r.uid === uid; }) || {}).lifetimePaid || '',
            supporter: (audit.find(function (r) { return r.uid === uid; }) || {}).supporter || ''
        });
    }

    const allHeader = ['source', 'uid', 'classification', 'subscriptionType', 'proExpiresAt', 'stripeCustomerId', 'contact_email', 'email_source', 'auth_email', 'stripe_email', 'checkout_email', 'customer_name', 'claimPro', 'hasActiveSub', 'pastDue', 'lifetimePaid', 'supporter'];
    writeCsv(path.join(BACKUPS, 'pro-entitlement-audit-2026-10-26-emails.csv'), allHeader, rows);

    const repairRows = repair.map(function (r) {
        const row = rows.find(function (x) { return x.uid === r.uid; }) || {};
        return {
            uid: r.uid,
            stripeCustomerId: r.stripeCustomerId,
            new_proExpiresAt: r.new_proExpiresAt,
            reason: r.reason,
            contact_email: row.contact_email || '',
            email_source: row.email_source || '',
            auth_email: row.auth_email || '',
            stripe_email: row.stripe_email || '',
            checkout_email: row.checkout_email || '',
            customer_name: row.customer_name || ''
        };
    });
    writeCsv(path.join(BACKUPS, 'stripe-pro-repair-2026-10-26-emails.csv'),
        ['uid', 'stripeCustomerId', 'new_proExpiresAt', 'reason', 'contact_email', 'email_source', 'auth_email', 'stripe_email', 'checkout_email', 'customer_name'],
        repairRows);

    const reviewKinds = new Set(['manual', 'lifetime-comp', 'past-due-still-pro', 'no-payment-evidence', 'recurring-no-active-sub', 'supporter-comp', 'stale-claim', 'supporter-only']);
    const reviewRows = rows.filter(function (r) { return reviewKinds.has(r.classification) || reviewKinds.has(r.source); });
    writeCsv(path.join(BACKUPS, 'pro-entitlement-review-2026-10-26-emails.csv'), allHeader, reviewRows);

    console.log('Real billing emails:', real, ' Auth-only/synthetic:', synthetic);
    console.log('Wrote:');
    console.log('  admin/backups/pro-entitlement-audit-2026-10-26-emails.csv');
    console.log('  admin/backups/stripe-pro-repair-2026-10-26-emails.csv');
    console.log('  admin/backups/pro-entitlement-review-2026-10-26-emails.csv');
    console.log('');
    console.log('Review/comp rows:');
    reviewRows.forEach(function (r) {
        console.log('  ' + (r.classification || r.source) + '  ' + (r.contact_email || '(no email)') + '  exp=' + r.proExpiresAt + '  uid=' + r.uid.slice(0, 8) + '…');
    });
}

main().catch(function (err) {
    console.error('Export failed:', err.message);
    process.exit(2);
});
