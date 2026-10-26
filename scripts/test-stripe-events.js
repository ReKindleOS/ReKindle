/*
 * Stripe webhook ordering/dedupe regression test.
 *
 * Run: node scripts/test-stripe-events.js
 *
 * The 2026-10-25 Workers Free outage showed why this matters: Stripe retried
 * every delivery from the blackout, and a retried cancellation/refund can
 * arrive after a newer checkout. Without the `stripe_state` guard it would
 * revoke a customer who had just paid again.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
    const {
        eventSeconds,
        subscriptionIdOf,
        uidFromSubscription,
        uidFromInvoice,
        staleRevocationReason,
        nextState
    } = await import('../workers/rekindle-stripe/events.js');

    // --- eventSeconds -----------------------------------------------------
    assert.strictEqual(eventSeconds({ created: 1700000000 }), 1700000000);
    assert.strictEqual(typeof eventSeconds({}), 'number');
    assert.strictEqual(typeof eventSeconds(null), 'number');

    // --- subscription ids -------------------------------------------------
    assert.strictEqual(subscriptionIdOf('sub_123'), 'sub_123');
    assert.strictEqual(subscriptionIdOf({ id: 'sub_123' }), 'sub_123');
    assert.strictEqual(subscriptionIdOf(null), null);
    assert.strictEqual(subscriptionIdOf({}), null);

    // --- uid fallbacks ----------------------------------------------------
    assert.strictEqual(uidFromSubscription({ metadata: { uid: 'u1' } }), 'u1');
    assert.strictEqual(uidFromSubscription({ metadata: {} }), null);
    assert.strictEqual(uidFromSubscription(null), null);

    assert.strictEqual(uidFromInvoice({ subscription_details: { metadata: { uid: 'u2' } } }), 'u2');
    assert.strictEqual(uidFromInvoice({ parent: { subscription_details: { metadata: { uid: 'u3' } } } }), 'u3');
    assert.strictEqual(uidFromInvoice({ lines: { data: [{ metadata: { uid: 'u4' } }] } }), 'u4');
    assert.strictEqual(uidFromInvoice({}), null);

    // --- stale revocation guard ------------------------------------------
    const DAY = 86400;
    const now = 1800000000;

    // A cancellation created before the newest grant is stale.
    assert.strictEqual(
        staleRevocationReason({ lastGrantAt: now }, { eventCreated: now - 3600 }),
        'older_than_last_grant'
    );
    // Same second is not stale (a real cancellation right after a grant must win).
    assert.strictEqual(
        staleRevocationReason({ lastGrantAt: now }, { eventCreated: now }),
        null
    );
    // A deletion for a different subscription than the one on file is stale.
    assert.strictEqual(
        staleRevocationReason({ lastGrantAt: 0, subscriptionId: 'sub_new' }, {
            eventCreated: now,
            subscriptionId: 'sub_old'
        }),
        'different_subscription'
    );
    // Legacy user with no state: a much later expiry means a newer plan.
    assert.strictEqual(
        staleRevocationReason({}, {
            eventCreated: now,
            periodEnd: now - 30 * DAY,
            proExpiresAt: (now + 30 * DAY) * 1000
        }),
        'newer_expiry'
    );
    // Legacy user whose current expiry is the deleted period: revoke.
    assert.strictEqual(
        staleRevocationReason({}, {
            eventCreated: now,
            periodEnd: now,
            proExpiresAt: (now + 2 * DAY) * 1000
        }),
        null
    );
    assert.strictEqual(staleRevocationReason(null, { eventCreated: now }), null);

    // --- monotonic state --------------------------------------------------
    assert.deepStrictEqual(nextState({}, { eventCreated: now, grant: true, subscriptionId: 'sub_1' }), {
        lastEventAt: now,
        lastGrantAt: now,
        subscriptionId: 'sub_1'
    });
    // A revoke records the event time but never lowers the grant marker.
    assert.deepStrictEqual(nextState({ lastEventAt: now, lastGrantAt: now, subscriptionId: 'sub_1' }, {
        eventCreated: now + 10,
        grant: false,
        subscriptionId: 'sub_1'
    }), {
        lastEventAt: now + 10,
        lastGrantAt: now,
        subscriptionId: 'sub_1'
    });
    // A stale grant cannot lower either marker.
    assert.deepStrictEqual(nextState({ lastEventAt: now, lastGrantAt: now, subscriptionId: 'sub_1' }, {
        eventCreated: now - 100,
        grant: true,
        subscriptionId: 'sub_old'
    }), {
        lastEventAt: now,
        lastGrantAt: now,
        subscriptionId: 'sub_old'
    });

    // --- source guards ----------------------------------------------------
    const worker = fs.readFileSync(path.join(__dirname, '..', 'workers', 'rekindle-stripe', 'worker.js'), 'utf8');
    assert.ok(worker.includes('staleRevocationReason(state'), 'revoke path must use the ordering guard');
    assert.ok(worker.includes('subscription_data[metadata][uid]'), 'checkout must store the uid on the subscription');
    assert.ok(worker.includes("getRes.status === 404"), 'unknown uid must not create a partial user document');
    assert.ok(worker.includes("endsWith('/health')"), 'worker must expose /health');
    assert.ok(worker.includes('Ignoring stale grant'), 'grant path must ignore stale retries');
    assert.ok(!/return new Response\('Received'/.test(worker.split('checkout.session.completed')[1] || ''), 'checkout must not fall through to a silent 200');

    console.log('PASS - Stripe webhook ordering/dedupe');
})().catch(err => {
    console.error('FAIL - Stripe webhook ordering/dedupe:', err);
    process.exit(1);
});
