/*
 * End-to-end Stripe webhook ordering test (no network).
 *
 * Run: node scripts/test-stripe-webhook.js
 *
 * Drives the real worker handler with a signed event and a mocked fetch so the
 * retry-ordering guard is exercised, not just its pure helper. This is the
 * regression for the 2026-10-25 outage: a retried cancellation must not revoke
 * a customer who re-subscribed after it.
 */
const assert = require('assert');
const crypto = require('crypto');

const secret = 'whsec_test';
const project = 'rekindle-dd1fa';
const DB = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

function pemPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
}

function signed(event) {
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return { body, header: `t=${t},v1=${v1}` };
}

function doc(fields) {
    return new Response(JSON.stringify({ name: 'projects/x/databases/(default)/documents/y', fields }), {
        status: 200, headers: { 'content-type': 'application/json' }
    });
}

async function main() {
    const { privateKey } = pemPair();
    const calls = [];
    const now = Math.floor(Date.now() / 1000);

    global.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init && init.method) || 'GET';
        calls.push({ url, method, body: init && init.body ? String(init.body) : '' });

        if (url === 'https://oauth2.googleapis.com/token') {
            return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
        }
        if (url.indexOf(`${DB}/stripe_state/uid1`) === 0) {
            if (method === 'GET') {
                return doc({
                    lastEventAt: { integerValue: String(now) },
                    lastGrantAt: { integerValue: String(now) },
                    subscriptionId: { stringValue: 'sub_new' }
                });
            }
            return doc({});
        }
        if (url.indexOf(`${DB}/users/uid1`) === 0) {
            if (method === 'GET') {
                return doc({
                    proExpiresAt: { timestampValue: new Date((now + 30 * 86400) * 1000).toISOString() },
                    isPro: { booleanValue: true }
                });
            }
            return doc({});
        }
        if (url.indexOf(`${DB}/users/ghost`) === 0) {
            return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
        }
        if (url.indexOf(`${DB}/stripe_state/ghost`) === 0) {
            return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
        }
        if (url.indexOf('identitytoolkit.googleapis.com') !== -1) {
            return new Response(JSON.stringify({ users: [{ localId: 'uid1', email: 'payer@example.com', customAttributes: '{}' }] }), { status: 200 });
        }
        if (url.indexOf('/config/supporters') !== -1) {
            return doc({});
        }
        throw new Error('unexpected fetch: ' + method + ' ' + url);
    };

    const worker = (await import('../workers/rekindle-stripe/worker.js')).default;
    const env = {
        STRIPE_WEBHOOK_SECRET: secret,
        FIREBASE_PROJECT_ID: project,
        FIREBASE_CLIENT_EMAIL: 'svc@example.com',
        FIREBASE_PRIVATE_KEY: privateKey,
        STRIPE_KEY: 'sk_test'
    };

    async function deliver(event) {
        const { body, header } = signed(event);
        const res = await worker.fetch(new Request('https://stripe.example/', {
            method: 'POST',
            headers: { 'stripe-signature': header, 'content-type': 'application/json' },
            body
        }), env, {});
        return { status: res.status, text: await res.text() };
    }

    // 1. A retried deletion from before a newer grant must be ignored.
    calls.length = 0;
    const stale = await deliver({
        id: 'evt_stale', type: 'customer.subscription.deleted', created: now - 3600,
        data: { object: { id: 'sub_old', customer: 'cus_1', metadata: { uid: 'uid1' }, current_period_end: now - 3600 } }
    });
    assert.strictEqual(stale.status, 200, stale.text);
    assert.ok(/stale/i.test(stale.text), 'expected a stale response: ' + stale.text);
    assert.ok(!calls.some(c => c.method === 'PATCH' && c.url.indexOf('/users/uid1') !== -1), 'stale deletion must not revoke');

    // 2. A deletion for the current subscription still revokes.
    calls.length = 0;
    const fresh = await deliver({
        id: 'evt_fresh', type: 'customer.subscription.deleted', created: now,
        data: { object: { id: 'sub_new', customer: 'cus_1', metadata: { uid: 'uid1' }, current_period_end: now } }
    });
    assert.strictEqual(fresh.status, 200, fresh.text);
    const revoke = calls.find(c => c.method === 'PATCH' && c.url.indexOf('/users/uid1') !== -1);
    assert.ok(revoke, 'fresh deletion must write the user document');
    assert.ok(revoke.body.indexOf('booleanValue') !== -1 && revoke.body.indexOf('false') !== -1, revoke.body);

    // 3. A checkout for an unknown uid must 500 (retryable), not create a doc.
    calls.length = 0;
    const ghost = await deliver({
        id: 'evt_ghost', type: 'checkout.session.completed', created: now,
        data: { object: { mode: 'payment', client_reference_id: 'ghost', customer: 'cus_ghost' } }
    });
    assert.strictEqual(ghost.status, 500, ghost.text);
    assert.ok(!calls.some(c => c.method === 'PATCH' && c.url.indexOf('/users/ghost') !== -1), 'must not create a partial user doc');

    // 4. An annual `subscription_create` invoice no longer has a top-level
    //    `invoice.subscription`; the subscription is under parent. This is the
    //    bug that gave yearly buyers only 32 days.
    calls.length = 0;
    const annual = await deliver({
        id: 'evt_annual', type: 'invoice.payment_succeeded', created: now,
        data: { object: {
            customer: 'cus_1',
            billing_reason: 'subscription_create',
            parent: { subscription_details: { subscription: 'sub_annual', metadata: { uid: 'uid1' } } },
            lines: { data: [{ period: { end: now + 365 * 86400 } }] }
        } }
    });
    assert.strictEqual(annual.status, 200, annual.text);
    const annualPatch = calls.find(c => c.method === 'PATCH' && c.url.indexOf('/users/uid1') !== -1);
    assert.ok(annualPatch, 'annual invoice must extend the user document');
    const annualBody = JSON.parse(annualPatch.body);
    const annualExpiry = new Date(annualBody.fields.proExpiresAt.timestampValue).getTime();
    assert.ok(annualExpiry > (now + 300 * 86400) * 1000, 'annual expiry should be ~1 year, got ' + annualBody.fields.proExpiresAt.timestampValue);

    console.log('PASS - Stripe webhook ordering (stale vs fresh cancellation, unknown uid, annual invoice)');
}

main().catch(err => {
    console.error('FAIL - Stripe webhook ordering:', err);
    process.exit(1);
});
