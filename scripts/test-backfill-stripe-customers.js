/*
 * Backfill planner regression test.
 *
 * Run: node scripts/test-backfill-stripe-customers.js
 *
 * The moderation console can only show a Stripe reference that the user
 * document carries. Stripe attaches no Customer to `mode=payment` Checkout
 * Sessions unless `customer_creation=always` is requested, so lifetime buyers
 * (`flamefencerplus`, `ryguy248248` - 168 of 171 in the 2026-10-26 audit) have
 * no `stripeCustomerId` at all; their Checkout Session id is the only handle.
 * These cases pin the rules that make the repair safe: never overwrite a linked
 * value, never guess between two customers, never create a document unless
 * asked.
 */
const assert = require('assert');

const { customerIdOf, collectCustomerLinks, planBackfill } = require('../admin/backfill_stripe_customers.js');

// --- customerIdOf ---------------------------------------------------------
assert.strictEqual(customerIdOf('cus_1'), 'cus_1');
assert.strictEqual(customerIdOf({ id: 'cus_2' }), 'cus_2');
assert.strictEqual(customerIdOf(null), '');
assert.strictEqual(customerIdOf({ object: 'customer' }), '');

// --- collectCustomerLinks -------------------------------------------------
const sessions = [
    { id: 'cs_paid', client_reference_id: 'u1', customer: 'cus_1', mode: 'payment', payment_status: 'paid', created: 100 },
    { id: 'cs_obj', client_reference_id: 'u2', customer: { id: 'cus_2' }, mode: 'subscription', payment_status: 'paid', created: 110 },
    { id: 'cs_np', client_reference_id: 'u3', customer: 'cus_3', mode: 'subscription', payment_status: 'no_payment_required', created: 120 },
    { id: 'cs_unpaid', client_reference_id: 'u4', customer: 'cus_4', mode: 'payment', payment_status: 'unpaid', created: 130 },
    { id: 'cs_guest', client_reference_id: '', customer: 'cus_5', mode: 'payment', payment_status: 'paid', created: 140 },
    // payment-mode session with no Stripe Customer: the lifetime case
    { id: 'cs_nocust', client_reference_id: 'u6', customer: null, mode: 'payment', payment_status: 'paid', created: 150 },
    { id: 'cs_nostatus', client_reference_id: 'u7', customer: 'cus_7', mode: 'payment', created: 160 },
    null
];
const links = collectCustomerLinks(sessions);
assert.deepStrictEqual(links.map(function (l) { return l.uid; }), ['u1', 'u2', 'u3', 'u6', 'u7']);
assert.strictEqual(links[1].customer, 'cus_2');
assert.strictEqual(links[0].sessionId, 'cs_paid');
assert.strictEqual(links[0].mode, 'payment');
assert.strictEqual(links[0].created, 100);
assert.strictEqual(links[3].customer, '');
assert.strictEqual(links[3].sessionId, 'cs_nocust');

// --- planBackfill: fills a missing customer, newest session first ----------
let plan = planBackfill(links, { u1: {}, u2: {} });
assert.deepStrictEqual(
    plan.updates.map(function (r) { return [r.uid, r.field, r.value, r.create]; }),
    [
        ['u2', 'stripeCustomerId', 'cus_2', false],
        ['u1', 'stripeCustomerId', 'cus_1', false]
    ]
);
assert.ok(plan.skipped.some(function (r) { return r.uid === 'u3' && r.action === 'no-user-doc'; }));
assert.strictEqual(plan.conflicts.length, 0);

// --- planBackfill: a lifetime session stores the Checkout Session id -------
plan = planBackfill([{ uid: 'u9', customer: '', sessionId: 'cs_live_9', mode: 'payment', created: 10 }], { u9: {} });
assert.deepStrictEqual(
    plan.updates.map(function (r) { return [r.field, r.value]; }),
    [['stripeCheckoutSessionId', 'cs_live_9']]
);

// --- already linked (same customer / same session) is left alone ----------
plan = planBackfill(links, { u1: { stripeCustomerId: 'cus_1' } });
assert.strictEqual(plan.updates.length, 0);
assert.ok(plan.skipped.some(function (r) { return r.uid === 'u1' && r.action === 'already-linked'; }));

plan = planBackfill([{ uid: 'u9', customer: '', sessionId: 'cs_live_9', mode: 'payment', created: 10 }],
    { u9: { stripeCheckoutSessionId: 'cs_live_9' } });
assert.strictEqual(plan.updates.length, 0);
assert.strictEqual(plan.skipped[0].action, 'already-linked-session');

// --- a linked customer is never replaced by a session id ------------------
plan = planBackfill([{ uid: 'u9', customer: '', sessionId: 'cs_live_9', mode: 'payment', created: 10 }],
    { u9: { stripeCustomerId: 'cus_existing' } });
assert.strictEqual(plan.updates.length, 0);
assert.strictEqual(plan.skipped[0].action, 'has-customer');

// --- a different existing customer is a conflict, never overwritten -------
plan = planBackfill(links, { u1: { stripeCustomerId: 'cus_other' } });
assert.strictEqual(plan.updates.length, 0);
assert.strictEqual(plan.conflicts.length, 1);
assert.strictEqual(plan.conflicts[0].action, 'different-customer');
assert.strictEqual(plan.conflicts[0].current, 'cus_other');

// --- a different existing session id is a conflict too --------------------
plan = planBackfill([{ uid: 'u9', customer: '', sessionId: 'cs_new', mode: 'payment', created: 10 }],
    { u9: { stripeCheckoutSessionId: 'cs_old' } });
assert.strictEqual(plan.updates.length, 0);
assert.strictEqual(plan.conflicts[0].action, 'different-session');

// --- two customers for one uid is a conflict ------------------------------
plan = planBackfill([
    { uid: 'u10', customer: 'cus_a', sessionId: 'cs_a', mode: 'payment', created: 10 },
    { uid: 'u10', customer: 'cus_b', sessionId: 'cs_b', mode: 'payment', created: 20 }
], { u10: {} });
assert.strictEqual(plan.updates.length, 0);
assert.strictEqual(plan.conflicts[0].action, 'multiple-customers');
assert.deepStrictEqual(plan.conflicts[0].stripe, ['cus_a', 'cus_b']);

// --- repeated sessions for one customer produce one update ----------------
plan = planBackfill([
    { uid: 'u8', customer: 'cus_8', sessionId: 'cs_old', mode: 'subscription', created: 10 },
    { uid: 'u8', customer: 'cus_8', sessionId: 'cs_new', mode: 'subscription', created: 20 }
], { u8: {} });
assert.strictEqual(plan.updates.length, 1);
assert.strictEqual(plan.updates[0].sessionId, 'cs_new');

// --- no user document: skipped by default, created only on request -------
const docless = [{ uid: 'u5', customer: '', sessionId: 'cs_5', mode: 'payment', created: 5 }];
plan = planBackfill(docless, {});
assert.strictEqual(plan.updates.length, 0);
assert.strictEqual(plan.skipped[0].action, 'no-user-doc');

plan = planBackfill(docless, {}, { createDocs: true });
assert.strictEqual(plan.updates.length, 1);
assert.strictEqual(plan.updates[0].create, true);
assert.strictEqual(plan.updates[0].field, 'stripeCheckoutSessionId');
assert.strictEqual(plan.skipped[0].action, 'create-doc');

// --- empty input ----------------------------------------------------------
plan = planBackfill([], {});
assert.deepStrictEqual(plan, { updates: [], skipped: [], conflicts: [] });

console.log('backfill planner: ok');
