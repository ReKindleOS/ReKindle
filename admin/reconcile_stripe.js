/*
 * Stripe ↔ Firestore reconciliation for ReKindle+.
 *
 * Why: Pro is granted and revoked only by the `rekindle-stripe` Cloudflare
 * Worker's webhook. When that Worker is unreachable (the 2026-10-25 free-tier
 * `error code: 1027` blackout, a bad deploy, or a Stripe endpoint outage),
 * Stripe retries for up to 3 days and then gives up. This script is the manual
 * safety net: it compares live Stripe state with `users/{uid}` and reports (and
 * optionally repairs) anything that drifted.
 *
 * Run read-only first (the default):
 *
 *   STRIPE_KEY=sk_live_... node admin/reconcile_stripe.js --since 2026-10-25T15:00:00Z
 *
 * Then, only after reviewing the list:
 *
 *   ... --fix-grants        # paid in Stripe but not Pro in Firestore
 *   ... --fix-revocations   # cancelled/refunded in Stripe but still Pro
 *
 * `STRIPE_KEY` is read from the environment and never printed. Use a restricted
 * key with read access to Charges, Customers, Subscriptions, Checkout Sessions
 * and Events; write access is not needed (all fixes go through Firebase).
 *
 * What it checks:
 *   1. Active/trialing Stripe subscriptions whose user is missing, expired or
 *      has a shorter expiry than the paid period (the "paid but not Pro" case).
 *   2. Completed checkout sessions since --since (lifetime + new subscriptions).
 *   3. `customer.subscription.deleted` and `charge.refunded` events since
 *      --since whose user is still Pro (the "cancelled but still Pro" case).
 *   4. Events Stripe still reports as undelivered (`delivery_success=false`) or
 *      with `pending_webhooks > 0`; these are the ones a retry may still fix.
 *
 * Exit code is 1 when drift is found, so it can be wired into a cron/CI job.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STRIPE_API = 'https://api.stripe.com/v1';
const DAY = 86400;
// The worker grants the paid period plus a two-day grace (see
// `invoice.payment_succeeded` / `customer.subscription.updated` in
// workers/rekindle-stripe/worker.js). Keep this in sync.
const GRACE_DAYS = 2;
const LIFETIME_EXPIRY = '2100-01-01T00:00:00.000Z';

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const SINCE = Math.floor(new Date(argValue('--since', new Date(Date.now() - 7 * DAY * 1000).toISOString())).getTime() / 1000);
const FIX_GRANTS = args.includes('--fix-grants');
const FIX_REVOCATIONS = args.includes('--fix-revocations');
const JSON_OUT = args.includes('--json');
const LIMIT = parseInt(argValue('--limit', '0'), 10) || 0;

if (!process.env.STRIPE_KEY) {
    console.error('Missing STRIPE_KEY. Run with:');
    console.error('  STRIPE_KEY=sk_live_... node admin/reconcile_stripe.js --since 2026-10-25T15:00:00Z');
    console.error('Use a restricted, read-only key. The script never prints it.');
    process.exit(2);
}
if (!fs.existsSync(path.join(ROOT, 'service-account.json'))) {
    console.error('Missing service-account.json next to package.json.');
    process.exit(2);
}

const admin = require('firebase-admin');
admin.initializeApp({
    credential: admin.credential.cert(require(path.join(ROOT, 'service-account.json')))
});
const db = admin.firestore();

function log() {
    if (!JSON_OUT) console.log.apply(console, arguments);
}
function iso(seconds) {
    return seconds ? new Date(seconds * 1000).toISOString() : '—';
}
function maskEmail(email) {
    if (!email) return '—';
    const at = String(email).indexOf('@');
    if (at < 1) return '***';
    return email.slice(0, 1) + '***' + email.slice(at);
}
function expiryMs(data) {
    const value = data && data.proExpiresAt;
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    return new Date(value).getTime();
}

async function stripe(pathname, params) {
    const url = new URL(STRIPE_API + pathname);
    Object.keys(params || {}).forEach(function (key) {
        const value = params[key];
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) value.forEach(function (item) { url.searchParams.append(key, item); });
        else url.searchParams.set(key, String(value));
    });
    const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + process.env.STRIPE_KEY }
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error('Stripe ' + res.status + ' ' + pathname + ': ' + body.slice(0, 300));
    }
    return res.json();
}

async function autoPage(pathname, params) {
    const out = [];
    let startingAfter = null;
    for (;;) {
        const pageParams = Object.assign({ limit: 100 }, params || {});
        if (startingAfter) pageParams.starting_after = startingAfter;
        const page = await stripe(pathname, pageParams);
        const rows = page.data || [];
        out.push.apply(out, rows);
        if (!page.has_more || rows.length === 0) break;
        startingAfter = rows[rows.length - 1].id;
        if (LIMIT && out.length >= LIMIT) break;
    }
    return LIMIT ? out.slice(0, LIMIT) : out;
}

function uidFromMetadata(object) {
    if (!object) return null;
    const meta = object.metadata;
    if (meta && typeof meta.uid === 'string' && meta.uid) return meta.uid;
    const details = object.subscription_details;
    if (details && details.metadata && details.metadata.uid) return details.metadata.uid;
    if (object.parent && object.parent.subscription_details && object.parent.subscription_details.metadata) {
        return object.parent.subscription_details.metadata.uid || null;
    }
    const lines = object.lines && object.lines.data;
    if (lines && lines[0] && lines[0].metadata && lines[0].metadata.uid) return lines[0].metadata.uid;
    return null;
}

function subscriptionId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value.id) return value.id;
    return null;
}

async function main() {
    const out = {
        generatedAt: new Date().toISOString(),
        since: iso(SINCE),
        fixGrants: FIX_GRANTS,
        fixRevocations: FIX_REVOCATIONS,
        failedEvents: [],
        drift: []
    };

    // ---------------------------------------------------------------------
    // 1. Index Firestore users by Stripe customer id and by uid.
    // ---------------------------------------------------------------------
    log('Reading Firestore users with a Stripe customer id...');
    const linked = await db.collection('users').where('stripeCustomerId', '>', '').get();
    const byCustomer = new Map();
    const byUid = new Map();
    linked.forEach(function (doc) {
        const data = doc.data() || {};
        const row = { uid: doc.id, data: data, expiry: expiryMs(data) };
        byUid.set(doc.id, row);
        if (data.stripeCustomerId) byCustomer.set(data.stripeCustomerId, row);
    });
    log('  ' + byUid.size + ' linked users');

    const supportersSnap = await db.doc('config/supporters').get();
    const supporters = supportersSnap.exists ? (supportersSnap.data() || {}) : {};

    async function rowFor(uid) {
        if (!uid) return null;
        if (byUid.has(uid)) return byUid.get(uid);
        const snap = await db.doc('users/' + uid).get();
        if (!snap.exists) return null;
        const data = snap.data() || {};
        const row = { uid: uid, data: data, expiry: expiryMs(data) };
        byUid.set(uid, row);
        return row;
    }

    async function emailForUid(uid) {
        try {
            const user = await admin.auth().getUser(uid);
            return user.email || null;
        } catch (e) {
            return null;
        }
    }

    function resolveRow(object) {
        const uid = uidFromMetadata(object);
        if (uid && byUid.has(uid)) return byUid.get(uid);
        if (uid) return { uid: uid, data: null, expiry: 0 };
        const customer = typeof object.customer === 'string' ? object.customer : (object.customer && object.customer.id);
        if (customer && byCustomer.has(customer)) return byCustomer.get(customer);
        const ref = object.client_reference_id;
        if (ref) return byUid.get(ref) || { uid: ref, data: null, expiry: 0 };
        return null;
    }

    // Metadata/client_reference_id can point at a user who has no
    // stripeCustomerId yet (checkout.session.completed was lost). Load the doc
    // instead of treating that as "user missing".
    async function loadRow(row) {
        if (!row || row.data) return row;
        const snap = await db.doc('users/' + row.uid).get();
        if (!snap.exists) return row;
        const data = snap.data() || {};
        const full = { uid: row.uid, data: data, expiry: expiryMs(data) };
        byUid.set(row.uid, full);
        return full;
    }

    // ---------------------------------------------------------------------
    // 2. Stripe retries still outstanding / failed.
    // ---------------------------------------------------------------------
    log('Checking Stripe event deliveries since ' + iso(SINCE) + '...');
    const failed = await autoPage('/events', {
        'created[gte]': SINCE,
        delivery_success: 'false'
    });
    const latest = await autoPage('/events', { limit: 100 });
    const pending = latest.filter(function (event) { return (event.pending_webhooks || 0) > 0; });
    out.failedEvents = failed.map(function (event) {
        return { id: event.id, type: event.type, created: iso(event.created), pendingWebhooks: event.pending_webhooks || 0 };
    }).concat(pending.map(function (event) {
        return { id: event.id, type: event.type, created: iso(event.created), pendingWebhooks: event.pending_webhooks || 0 };
    }));
    const seenFailed = new Set();
    out.failedEvents = out.failedEvents.filter(function (event) {
        if (seenFailed.has(event.id)) return false;
        seenFailed.add(event.id);
        return true;
    });
    if (!JSON_OUT) {
        if (out.failedEvents.length === 0) {
            log('  no failed or pending deliveries');
        } else {
            log('  ' + out.failedEvents.length + ' failed/pending event(s):');
            out.failedEvents.forEach(function (event) {
                log('    ' + event.created + '  ' + event.type + '  ' + event.id + '  pending=' + event.pendingWebhooks);
            });
        }
    }

    // ---------------------------------------------------------------------
    // 3. Active subscriptions must map to an unexpired Pro user.
    // ---------------------------------------------------------------------
    log('Checking active Stripe subscriptions...');
    const activeUids = new Set();
    for (const status of ['active', 'trialing']) {
        const subs = await autoPage('/subscriptions', { status: status });
        for (const sub of subs) {
            const row = await loadRow(resolveRow(sub));
            // Newer Stripe API versions moved current_period_end onto the
            // subscription item. Without this fallback every active sub looks
            // like it ends in two days (and an annual repair would grant 30d).
            const cpe = sub.current_period_end ||
                (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || 0;
            const expected = cpe + GRACE_DAYS * DAY;
            const base = { kind: 'paid-not-pro', subscription: sub.id, customer: sub.customer, status: sub.status, periodEnd: iso(cpe) };
            if (!row) {
                out.drift.push(Object.assign(base, { uid: null, detail: 'no Firestore user for subscription/customer' }));
                continue;
            }
            if (!row.data) {
                out.drift.push(Object.assign(base, { uid: row.uid, detail: 'uid in metadata but users/{uid} does not exist' }));
                continue;
            }
            activeUids.add(row.uid);
            if (row.expiry < Date.now()) {
                out.drift.push(Object.assign(base, { uid: row.uid, detail: 'user expired (proExpiresAt=' + iso(row.expiry / 1000) + ')' }));
            } else if (expected * 1000 > row.expiry + DAY * 1000) {
                out.drift.push(Object.assign(base, { uid: row.uid, detail: 'expiry short: proExpiresAt=' + iso(row.expiry / 1000) + ' expected>=' + iso(expected) }));
            }
        }
    }

    // ---------------------------------------------------------------------
    // 4. Completed checkout sessions since the window (lifetime + new subs).
    // ---------------------------------------------------------------------
    log('Checking completed checkout sessions since ' + iso(SINCE) + '...');
    let sessions = [];
    try {
        sessions = await autoPage('/checkout/sessions', { 'created[gte]': SINCE, status: 'complete', 'expand[]': ['data.subscription'] });
    } catch (e) {
        // A restricted key may only have subscriptions/events read. Do not
        // abort the whole reconciliation for the optional checkout check.
        if (/checkout_session_read|403/.test(e.message)) {
            log('  skipped: the Stripe key lacks checkout_session_read');
        } else {
            throw e;
        }
    }
    for (const session of sessions) {
        const row = await loadRow(resolveRow(session));
        if (!row) continue;
        const base = { kind: 'checkout-not-pro', session: session.id, customer: session.customer, mode: session.mode, created: iso(session.created) };
        if (!row.data) {
            out.drift.push(Object.assign(base, { uid: row.uid, detail: 'checkout uid has no users/{uid} document' }));
            continue;
        }
        if (session.mode === 'payment') {
            // Lifetime: the worker writes a year-2100 expiry.
            if (row.expiry < Date.now() + 365 * DAY * 1000) {
                out.drift.push(Object.assign(base, { uid: row.uid, detail: 'lifetime paid but proExpiresAt=' + iso(row.expiry / 1000) }));
            }
            continue;
        }
        const sub = session.subscription;
        const expected = subscriptionId(sub) && typeof sub === 'object' && sub.current_period_end
            ? sub.current_period_end + GRACE_DAYS * DAY
            : session.created + 32 * DAY;
        if (row.expiry < Date.now() || expected * 1000 > row.expiry + DAY * 1000) {
            out.drift.push(Object.assign(base, { uid: row.uid, detail: 'subscription checkout not Pro (proExpiresAt=' + iso(row.expiry / 1000) + ')' }));
        }
    }

    // ---------------------------------------------------------------------
    // 5. Cancellations/refunds since the window must not leave Pro active.
    // ---------------------------------------------------------------------
    log('Checking cancellation/refund events since ' + iso(SINCE) + '...');
    const badEvents = await autoPage('/events', {
        'created[gte]': SINCE,
        'types[]': ['customer.subscription.deleted', 'charge.refunded']
    });
    for (const event of badEvents) {
        const object = event.data && event.data.object ? event.data.object : {};
        const row = await loadRow(resolveRow(object));
        if (!row || !row.data) continue;
        // A re-subscribe after the cancellation is not drift: the customer has
        // a newer active subscription (this is the ordering case the Worker guards).
        if (activeUids.has(row.uid)) continue;
        if (event.type === 'charge.refunded') {
            const fullyRefunded = object.refunded === true ||
                (typeof object.amount_refunded === 'number' && typeof object.amount === 'number' && object.amount_refunded >= object.amount);
            if (!fullyRefunded) continue; // partial refunds do not revoke Pro
        }
        if (row.expiry > Date.now() + DAY * 1000) {
            out.drift.push({
                kind: event.type === 'charge.refunded' ? 'refunded-still-pro' : 'cancelled-still-pro',
                event: event.id,
                eventCreated: iso(event.created),
                uid: row.uid,
                customer: object.customer || null,
                detail: 'proExpiresAt=' + iso(row.expiry / 1000) + ' is still in the future'
            });
        }
    }

    // ---------------------------------------------------------------------
    // 6. Supporters-only entry (rules grant Pro, but pro-gate reads the doc).
    // ---------------------------------------------------------------------
    for (const email of Object.keys(supporters)) {
        const entry = supporters[email];
        const expires = entry && entry.expiresAt;
        const ms = expires && expires.toMillis ? expires.toMillis() : (expires ? new Date(expires).getTime() : 0);
        if (ms <= Date.now()) continue;
        let uid = null;
        try {
            uid = (await admin.auth().getUserByEmail(email)).uid;
        } catch (e) { /* not an account */ }
        if (!uid) continue;
        const row = await rowFor(uid);
        if (row && row.expiry > Date.now()) continue;
        out.drift.push({
            kind: 'supporters-only',
            uid: uid,
            email: maskEmail(email),
            detail: 'config/supporters expires ' + iso(ms / 1000) + ' but users/{uid}.proExpiresAt is ' + (row ? iso(row.expiry / 1000) : 'missing')
        });
    }

    // ---------------------------------------------------------------------
    // 7. Report.
    // ---------------------------------------------------------------------
    if (JSON_OUT) {
        out.summary = {
            drift: out.drift.length,
            failedEvents: out.failedEvents.length,
            paidNotPro: out.drift.filter(function (d) { return d.kind === 'paid-not-pro' || d.kind === 'checkout-not-pro'; }).length,
            stillPro: out.drift.filter(function (d) { return d.kind === 'cancelled-still-pro' || d.kind === 'refunded-still-pro'; }).length
        };
        console.log(JSON.stringify(out, null, 2));
    } else {
        log('');
        log('Drift: ' + out.drift.length + ' item(s)');
        out.drift.forEach(function (item) {
            log('  ' + item.kind + '  uid=' + (item.uid || '—') + '  ' + item.detail);
        });
        log('');
        log('Summary: paid-not-pro=' + out.drift.filter(function (d) { return d.kind === 'paid-not-pro' || d.kind === 'checkout-not-pro'; }).length
            + '  cancelled/refunded-still-pro=' + out.drift.filter(function (d) { return d.kind === 'cancelled-still-pro' || d.kind === 'refunded-still-pro'; }).length
            + '  supporters-only=' + out.drift.filter(function (d) { return d.kind === 'supporters-only'; }).length);
    }

    // ---------------------------------------------------------------------
    // 8. Optional repairs (explicit flags only).
    // ---------------------------------------------------------------------
    const { mergeClaims } = await import('../workers/rekindle-stripe/claims.js');

    let repaired = 0;

    async function grant(row, expiresAtMs, source) {
        const expires = new Date(expiresAtMs);
        if (row.expiry && expiresAtMs <= row.expiry + DAY * 1000) {
            log('  skip grant (existing expiry is already later): ' + row.uid);
            repaired++;
            return;
        }
        row.expiry = expiresAtMs;
        await db.collection('users').doc(row.uid).set({
            isPro: true,
            proExpiresAt: admin.firestore.Timestamp.fromDate(expires),
            subscriptionType: source === 'lifetime' ? 'lifetime' : 'recurring'
        }, { merge: true });
        const email = await emailForUid(row.uid);
        if (email) {
            const value = { expiresAt: admin.firestore.Timestamp.fromDate(source === 'lifetime' ? new Date(LIFETIME_EXPIRY) : expires), isLifetime: source === 'lifetime' };
            const patch = {};
            patch[email] = value;
            await db.doc('config/supporters').set(patch, { merge: true });
        }
        try {
            const user = await admin.auth().getUser(row.uid);
            await admin.auth().setCustomUserClaims(row.uid, mergeClaims(user.customClaims || {}, { pro: true }));
        } catch (e) {
            log('  warning: could not set pro claim for ' + row.uid + ': ' + e.message);
        }
        log('  fixed grant: ' + row.uid + ' -> ' + expires.toISOString());
        repaired++;
    }

    async function revoke(row) {
        await db.collection('users').doc(row.uid).set({
            isPro: false,
            proExpiresAt: admin.firestore.Timestamp.fromDate(new Date())
        }, { merge: true });
        const email = await emailForUid(row.uid);
        if (email) {
            const patch = {};
            patch[email] = admin.firestore.FieldValue.delete();
            await db.doc('config/supporters').set(patch, { merge: true });
        }
        try {
            const user = await admin.auth().getUser(row.uid);
            await admin.auth().setCustomUserClaims(row.uid, mergeClaims(user.customClaims || {}, { pro: false }));
        } catch (e) {
            log('  warning: could not clear pro claim for ' + row.uid + ': ' + e.message);
        }
        log('  fixed revoke: ' + row.uid);
        repaired++;
    }

    if (FIX_GRANTS || FIX_REVOCATIONS) {
        log('');
        log('Applying fixes...');
        for (const item of out.drift) {
            const row = await rowFor(item.uid);
            if (!row) continue;
            if (FIX_GRANTS && (item.kind === 'paid-not-pro' || item.kind === 'checkout-not-pro')) {
                const lifetime = item.mode === 'payment';
                // Use the Stripe period end (annual plans included), with a
                // 30-day floor only when the period end is missing/stale.
                const periodMs = item.periodEnd && item.periodEnd !== '—' ? new Date(item.periodEnd).getTime() + GRACE_DAYS * DAY * 1000 : 0;
                const expires = lifetime ? new Date(LIFETIME_EXPIRY).getTime() : Math.max(
                    periodMs,
                    Date.now() + 30 * DAY * 1000
                );
                await grant(row, expires, lifetime ? 'lifetime' : 'recurring');
            }
            if (FIX_GRANTS && item.kind === 'supporters-only') {
                const email = await emailForUid(item.uid);
                const entry = email ? supporters[email] : null;
                const ms = entry && entry.expiresAt && entry.expiresAt.toMillis ? entry.expiresAt.toMillis() : Date.now() + 365 * DAY * 1000;
                await grant(row, ms, ms > Date.now() + 50 * 365 * DAY * 1000 ? 'lifetime' : 'recurring');
            }
            if (FIX_REVOCATIONS && (item.kind === 'cancelled-still-pro' || item.kind === 'refunded-still-pro')) {
                if (activeUids.has(row.uid)) continue;
                await revoke(row);
            }
        }
    } else if (out.drift.length || out.failedEvents.length) {
        log('');
        log('Read-only run. Re-run with --fix-grants / --fix-revocations after reviewing the list.');
    }

    const critical = out.drift.filter(function (d) { return d.kind === 'paid-not-pro' || d.kind === 'checkout-not-pro'; }).length;
    const remaining = out.drift.length - repaired;
    process.exitCode = (remaining > 0 || out.failedEvents.length > 0) ? 1 : 0;
    if (FIX_GRANTS || FIX_REVOCATIONS) {
        log('');
        log('Repaired ' + repaired + ' of ' + out.drift.length + ' drift item(s).');
        if (remaining > 0) log('Remaining ' + remaining + ' item(s) need manual review (see the list above).');
    } else if (critical) {
        log('');
        log('CRITICAL: ' + critical + ' customer(s) paid in Stripe but are not Pro in Firestore.');
    }
}

main().catch(function (err) {
    console.error('Reconciliation failed:', err.message);
    process.exit(2);
});
