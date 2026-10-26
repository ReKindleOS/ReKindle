import { mergeClaims } from './claims.js';
import { eventSeconds, subscriptionIdOf, uidFromSubscription, uidFromInvoice, staleRevocationReason, nextState } from './events.js';

// Per-isolate caches. The OAuth token is valid for an hour; minting one per
// call (a webhook could call it three times) is pure latency.
const googleTokenCache = { token: null, expiresAt: 0 };
const googleJwkCache = { keys: null, expiresAt: 0 };

async function getGoogleJwks() {
    if (googleJwkCache.keys && googleJwkCache.expiresAt > Date.now()) return googleJwkCache.keys;
    const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    if (!res.ok) throw new Error('Could not fetch Google public keys');
    const data = await res.json();
    googleJwkCache.keys = data.keys || [];
    googleJwkCache.expiresAt = Date.now() + 6 * 60 * 60 * 1000;
    return googleJwkCache.keys;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // --- CORS Handler ---
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, stripe-signature',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        // --- HEALTH (no secrets) ---
        // Lets an uptime monitor distinguish "worker is up" from the
        // CORS-less `error code: 1027` page returned when the account is over
        // its Workers Free daily request limit.
        if (request.method === 'GET' && url.pathname.endsWith('/health')) {
            return new Response(JSON.stringify({
                ok: true,
                service: 'rekindle-stripe',
                stripeKey: !!env.STRIPE_KEY,
                firebase: !!(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY)
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
            });
        }

        // --- NEW: API Endpoint for Admin ---
        if (request.method === 'GET' && url.pathname.endsWith('/subscribers')) {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }

            try {
                const subscribers = await fetchActiveSubscribers(env);
                return new Response(JSON.stringify(subscribers), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } catch (err) {
                return new Response('Error fetching subscribers: ' + err.message, {
                    status: 500,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        // --- NEW: Resolve UIDs to usernames via Firebase Auth ---
        if (request.method === 'POST' && url.pathname.endsWith('/resolve-users')) {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }

            try {
                const body = await request.json();
                const uids = body.uids || [];

                if (uids.length === 0) {
                    return new Response(JSON.stringify([]), {
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                }

                const resolved = await resolveFirebaseUsers(env, uids);
                return new Response(JSON.stringify(resolved), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } catch (err) {
                return new Response('Error resolving users: ' + err.message, {
                    status: 500,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        // --- NEW: Sync Pro Users to config/supporters ---
        if (request.method === 'POST' && url.pathname.endsWith('/sync-pro-users')) {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }

            try {
                const body = await request.json();
                const users = body.users || [];
                const result = await bulkSyncSupporters(env, users);
                return new Response(JSON.stringify(result), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } catch (err) {
                return new Response('Error syncing users: ' + err.message, {
                    status: 500,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        // --- NEW: Sync Pro Custom Claims for all active subscribers ---
        if (request.method === 'POST' && url.pathname.endsWith('/sync-pro-claims')) {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }

            try {
                const result = await bulkSyncProClaims(env);
                return new Response(JSON.stringify(result), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } catch (err) {
                return new Response('Error syncing pro claims: ' + err.message, {
                    status: 500,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        // --- CREATE CHECKOUT SESSION ---
        // Called by pay.html to create a server-side session with client_reference_id baked in,
        // preventing guest checkout from stripping it from the URL.
        if (request.method === 'POST' && url.pathname.endsWith('/create-checkout')) {
            const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
            try {
                const body = await request.json();
                const { idToken, plan, success_url, cancel_url } = body;

                if (!idToken || !plan) {
                    return new Response(JSON.stringify({ error: 'Missing idToken or plan' }), { status: 400, headers: corsHeaders });
                }

                const priceIds = {
                    monthly:  env.STRIPE_PRICE_MONTHLY,
                    yearly:   env.STRIPE_PRICE_YEARLY,
                    lifetime: env.STRIPE_PRICE_LIFETIME
                };
                const priceId = priceIds[plan];
                if (!priceId) {
                    return new Response(JSON.stringify({ error: 'Invalid plan' }), { status: 400, headers: corsHeaders });
                }

                const uid = await verifyFirebaseIdToken(env, idToken);

                const params = new URLSearchParams({
                    'client_reference_id': uid,
                    'mode': plan === 'lifetime' ? 'payment' : 'subscription',
                    'line_items[0][price]': priceId,
                    'line_items[0][quantity]': '1',
                    'allow_promotion_codes': 'true',
                    'success_url': success_url || 'https://rekindle.ink/pay?success=true',
                    'cancel_url': cancel_url || 'https://rekindle.ink/pay',
                });
                // Carry the uid on the Customer/Subscription too. A renewal
                // invoice only carries the customer, so if
                // checkout.session.completed was ever lost, the uid in
                // metadata is the fallback that lets us still grant Pro.
                params.set('metadata[uid]', uid);
                if (plan === 'lifetime') params.set('payment_intent_data[metadata][uid]', uid);
                else params.set('subscription_data[metadata][uid]', uid);

                const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.STRIPE_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                if (!stripeRes.ok) {
                    const err = await stripeRes.text();
                    throw new Error(`Stripe API Error: ${stripeRes.status} ${err}`);
                }

                const session = await stripeRes.json();
                return new Response(JSON.stringify({ url: session.url }), { headers: corsHeaders });

            } catch (err) {
                return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
            }
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }


        const signature = request.headers.get('stripe-signature');
        if (!signature) {
            return new Response('Missing Stripe Signature', { status: 400 });
        }

        const bodyText = await request.text();

        // 1. Verify Stripe Signature
        try {
            await verifyStripeSignature(signature, bodyText, env.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            return new Response('Invalid Signature: ' + err.message, { status: 400 });
        }

        const event = JSON.parse(bodyText);

        // 2. Handle Events
        const eventCreated = eventSeconds(event);
        try {
            if (event.type === 'checkout.session.completed') {
                // NEW SUBSCRIPTION or ONE-TIME PAYMENT
                const session = event.data.object;
                const uid = session.client_reference_id;
                const stripeCustomerId = session.customer;

                if (!uid) {
                    // Never swallow this with a 200: a paid session with no uid
                    // would otherwise be lost forever (Stripe stops retrying).
                    console.error('checkout.session.completed without client_reference_id:', event.id);
                    return new Response('Error: checkout session has no client_reference_id', { status: 500 });
                }

                // Check Mode: 'payment' = Lifetime, 'subscription' = Recurring
                let days = 32; // Default subscription buffer
                let subscriptionType = 'recurring';

                if (session.mode === 'payment') {
                    days = 36500; // Lifetime (100 years)
                    subscriptionType = 'lifetime';
                }

                const written = await updateFirestoreUser(env, uid, {
                    days,
                    stripeCustomerId,
                    subscriptionType,
                    eventCreated,
                    subscriptionId: subscriptionIdOf(session.subscription)
                });
                if (written && written.status === 'user_not_found') {
                    return new Response('Retry: checkout uid is not a Firebase Auth account', { status: 500 });
                }
                return new Response(`Success: New ${session.mode} activated`, { status: 200 });
            }
            else if (event.type === 'invoice.payment_succeeded') {
                // RENEWAL - Extend subscription
                const invoice = event.data.object;
                const customerId = invoice.customer;
                // Stripe's newer API moved the subscription off the top-level
                // `invoice.subscription` field: it now lives under
                // parent.subscription_details (or the line's parent). The old
                // check silently ignored every annual `subscription_create`
                // invoice, so yearly buyers got only the checkout's 32 days.
                const subId = subscriptionIdOf(invoice.subscription)
                    || (invoice.parent && invoice.parent.subscription_details && subscriptionIdOf(invoice.parent.subscription_details.subscription))
                    || (invoice.lines && invoice.lines.data && invoice.lines.data[0] && invoice.lines.data[0].parent &&
                        invoice.lines.data[0].parent.subscription_item_details &&
                        subscriptionIdOf(invoice.lines.data[0].parent.subscription_item_details.subscription));
                const metadataUid = uidFromInvoice(invoice);

                // SKIP: subscription_update invoices (prorations) often have 'today' as period_end
                if (invoice.billing_reason === 'subscription_update') {
                    return new Response('Skipped subscription_update invoice', { status: 200 });
                }

                // If the invoice is for a subscription (not one-time), extend their access
                if (subId && (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_create')) {
                    if (!customerId && !metadataUid) {
                        console.error('invoice.payment_succeeded without customer or uid:', event.id);
                        return new Response('Error: invoice has no customer or uid', { status: 500 });
                    }
                    // Pick the line that belongs to this subscription (an
                    // invoice can have proration/discount lines first), then
                    // use its period end. invoice.period_end is not always the
                    // subscription period for prorations.
                    const lines = (invoice.lines && invoice.lines.data) || [];
                    const subLine = lines.find(function (line) {
                        const sid = line.parent && line.parent.subscription_item_details &&
                            line.parent.subscription_item_details.subscription;
                        return sid === subId;
                    }) || lines[0];
                    const periodEnd = subLine && subLine.period && subLine.period.end;
                    if (!periodEnd) {
                        console.error('invoice.payment_succeeded without a period end:', event.id);
                        return new Response('Error: invoice has no line period end', { status: 500 });
                    }
                    const expiresAt = new Date(periodEnd * 1000 + (86400 * 1000 * 2)); // +2 day buffer
                    const result = await extendSubscriptionByCustomerId(env, customerId, {
                        expiresAt,
                        eventCreated,
                        subscriptionId: subId,
                        uid: metadataUid
                    });

                    if (result.status === 'user_not_found') {
                        // Retry later if user is not yet linked (race condition with checkout event)
                        return new Response(`Retry: User not found yet for customer ${customerId || metadataUid}`, { status: 500 });
                    }
                    return new Response(`Success: Subscription renewed for UID ${result.uid} (Expires: ${expiresAt.toISOString()})`, { status: 200 });
                }
                return new Response('Ignored non-subscription invoice', { status: 200 });
            }
            else if (event.type === 'customer.subscription.updated') {
                const subscription = event.data.object;
                const customerId = subscription.customer;
                const status = subscription.status;
                const metadataUid = uidFromSubscription(subscription);

                // Overdue or exhausted retries — revoke access
                if (status === 'past_due' || status === 'unpaid') {
                    if (!customerId && !metadataUid) {
                        console.error('customer.subscription.updated without customer or uid:', event.id);
                        return new Response('Error: subscription has no customer or uid', { status: 500 });
                    }
                    const result = await revokeProByCustomerId(env, customerId, {
                        eventCreated,
                        subscriptionId: subscription.id,
                        periodEnd: subscription.current_period_end,
                        uid: metadataUid
                    });
                    return new Response(`Success: Pro paused due to ${status} payment (${result.status})`, { status: 200 });
                }

                // Payment recovered or plan changed — extend access
                if (status === 'active' || status === 'trialing') {
                    let currentPeriodEnd = subscription.current_period_end;
                    if (!currentPeriodEnd && subscription.items && subscription.items.data && subscription.items.data.length > 0) {
                        currentPeriodEnd = subscription.items.data[0].current_period_end;
                    }

                    if (currentPeriodEnd) {
                        if (!customerId && !metadataUid) {
                            console.error('customer.subscription.updated without customer or uid:', event.id);
                            return new Response('Error: subscription has no customer or uid', { status: 500 });
                        }
                        const expiresAt = new Date((currentPeriodEnd * 1000) + (86400 * 1000 * 2));
                        const result = await extendSubscriptionByCustomerId(env, customerId, {
                            expiresAt,
                            eventCreated,
                            subscriptionId: subscription.id,
                            uid: metadataUid
                        });
                        if (result.status === 'user_not_found') {
                            return new Response('Retry: User not found yet', { status: 500 });
                        }
                        return new Response(`Success: Subscription updated (${result.status})`, { status: 200 });
                    }
                }

                return new Response(`Ignored subscription.updated with status: ${status}`, { status: 200 });
            }
            else if (event.type === 'customer.subscription.deleted') {
                // CANCELLATION
                const subscription = event.data.object;
                const customerId = subscription.customer;
                const metadataUid = uidFromSubscription(subscription);

                if (!customerId && !metadataUid) {
                    console.error('customer.subscription.deleted without customer or uid:', event.id);
                    return new Response('Error: subscription has no customer or uid', { status: 500 });
                }

                const result = await revokeProByCustomerId(env, customerId, {
                    eventCreated,
                    subscriptionId: subscription.id,
                    periodEnd: subscription.current_period_end,
                    uid: metadataUid
                });
                return new Response(`Success: Subscription cancelled and revoked (${result.status})`, { status: 200 });
            }
            else if (event.type === 'charge.refunded') {
                // REFUND - Revoke access immediately, unless it is older than a
                // newer grant (see staleRevocationReason in events.js).
                const charge = event.data.object;
                const customerId = charge.customer;
                const fullyRefunded = charge.refunded === true ||
                    (typeof charge.amount_refunded === 'number' && typeof charge.amount === 'number' && charge.amount_refunded >= charge.amount);

                // Stripe emits charge.refunded for partial refunds too. A
                // goodwill refund of a few dollars must not cancel Pro.
                if (!fullyRefunded) {
                    console.log('Ignoring partial refund:', event.id);
                    return new Response('Ignored partial refund', { status: 200 });
                }

                if (customerId) {
                    const result = await revokeProByCustomerId(env, customerId, { eventCreated });
                    return new Response(`Success: Pro status revoked due to refund (${result.status})`, { status: 200 });
                }
                console.warn('No customer ID in refund event', event.id);
                return new Response('Ignored refund without customer', { status: 200 });
            }
        } catch (e) {
            console.error('Webhook processing error:', event.id, event.type, e);
            return new Response('Error: ' + e.message, { status: 500 });
        }

        return new Response('Received', { status: 200 });
    }
};

// --- STRIPE VERIFICATION ---
async function verifyStripeSignature(header, payload, secret) {
    if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET env var");

    // Header format: t=timestamp,v1=signature
    const parts = header.split(',').reduce((acc, item) => {
        const [k, v] = item.split('=');
        acc[k] = v;
        return acc;
    }, {});

    if (!parts.t || !parts.v1) throw new Error("Invalid signature header format");

    const timestamp = parts.t;
    const signedPayload = `${timestamp}.${payload}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
    );

    const signatureBytes = hexToBytes(parts.v1);
    const isValid = await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        encoder.encode(signedPayload)
    );

    if (!isValid) throw new Error("Signature mismatch");

    // Check timestamp (prevent replay attacks, e.g. 5 mins tolerance)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) {
        throw new Error("Timestamp too old");
    }
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

// --- STRIPE STATE (server-only, no client rule grants access) ---
// Stores the newest grant event time and subscription id so a retried
// cancellation/refund from before an outage cannot revoke a newer payment.
async function getStripeState(env, token, uid) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const res = await fetch(`${baseUrl}/stripe_state/${uid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 404) return { lastEventAt: 0, lastGrantAt: 0, subscriptionId: '' };
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`stripe_state read failed ${res.status}: ${text}`);
    }
    const doc = await res.json();
    const f = doc.fields || {};
    return {
        lastEventAt: Number((f.lastEventAt && f.lastEventAt.integerValue) || 0),
        lastGrantAt: Number((f.lastGrantAt && f.lastGrantAt.integerValue) || 0),
        subscriptionId: (f.subscriptionId && f.subscriptionId.stringValue) || ''
    };
}

async function putStripeState(env, token, uid, state) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const body = {
        fields: {
            lastEventAt: { integerValue: String(state.lastEventAt || 0) },
            lastGrantAt: { integerValue: String(state.lastGrantAt || 0) },
            subscriptionId: { stringValue: state.subscriptionId || '' },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };
    const res = await fetch(`${baseUrl}/stripe_state/${uid}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`stripe_state write failed ${res.status}: ${text}`);
    }
    return await res.json();
}

async function recordStripeState(env, token, uid, opts) {
    const prev = await getStripeState(env, token, uid);
    const next = nextState(prev, opts);
    if (next.lastEventAt === prev.lastEventAt &&
        next.lastGrantAt === prev.lastGrantAt &&
        next.subscriptionId === prev.subscriptionId) {
        return next;
    }
    await putStripeState(env, token, uid, next);
    return next;
}

// --- FIRESTORE UPDATE ---
async function updateFirestoreUser(env, uid, { days = null, expiresAt = null, stripeCustomerId = null, subscriptionType = null, eventCreated = null, subscriptionId = null } = {}) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    // A retried grant created before the newest processed event must not
    // resurrect Pro (for example a retried checkout.session.completed after
    // the user cancelled). Compare with lastEventAt, not lastGrantAt: a
    // yearly-plan renewal invoice and its checkout can share a second, and
    // the invoice is what carries the real 365-day period.
    const priorState = await getStripeState(env, token, uid);
    if (eventCreated && priorState.lastEventAt && eventCreated < priorState.lastEventAt) {
        console.warn(`Ignoring stale grant (${eventCreated} < ${priorState.lastEventAt}) for UID ${uid}`);
        return { status: 'stale_grant', uid: uid };
    }

    // 1. Calculate Proposed Expiry
    let newExpiryDate;
    if (expiresAt) {
        newExpiryDate = new Date(expiresAt);
    } else if (days) {
        newExpiryDate = new Date();
        newExpiryDate.setDate(newExpiryDate.getDate() + days);
    } else {
        newExpiryDate = new Date();
        newExpiryDate.setDate(newExpiryDate.getDate() + 32);
    }

    // 2. Fetch Existing User to Prevent Downgrades (Race Condition Protection)
    // If a later expiry already exists, keep it.
    let currentExpiry = 0;
    const getRes = await fetch(`${baseUrl}/users/${uid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (getRes.status === 404) {
        // A users/{uid} document is only created when someone saves a setting
        // or a favourite, so a brand-new account (the typical first purchase)
        // has none. That used to return user_not_found, the webhook 500'd, and
        // Stripe gave up after 3 days of retries even though the payment was
        // real. Confirm the account exists in Firebase Auth instead; the PATCH
        // below then creates the document with just the entitlement fields.
        // A uid that is not in Auth is still treated as bogus (no partial doc).
        const authUser = await lookupFirebaseAuthUser(env, uid, token);
        if (!authUser) {
            console.warn('Stripe event references unknown uid:', uid);
            return { status: 'user_not_found', uid };
        }
        console.log('Granting to a payer with no users document yet:', uid);
    } else if (!getRes.ok) {
        // Do not fall through to the write: a transient read error must make
        // the webhook return 500 so Stripe retries, not overwrite blind.
        const text = await getRes.text();
        throw new Error(`Firestore user lookup failed ${getRes.status}: ${text}`);
    } else {
        const userDoc = await getRes.json();
        if (userDoc.fields && userDoc.fields.proExpiresAt && userDoc.fields.proExpiresAt.timestampValue) {
            currentExpiry = new Date(userDoc.fields.proExpiresAt.timestampValue).getTime();
        }
    }

    // Only update expiry if new date is LATER than current (or if current doesn't exist)
    const newExpiryTime = newExpiryDate.getTime();
    let finalExpiryDate = newExpiryDate;

    // Safety check: if existing is significantly later (e.g. > 1 day later), assume existing is correct
    // This handles the "Checkout (Monthly)" arriving after "Upgrade (Yearly)" case.
    if (currentExpiry > newExpiryTime + 86400000) {
        console.log(`Preserving existing expiry ${new Date(currentExpiry).toISOString()} over new ${newExpiryDate.toISOString()}`);
        finalExpiryDate = new Date(currentExpiry);
    }

    let updateMask = 'updateMask.fieldPaths=isPro&updateMask.fieldPaths=proExpiresAt';
    const fields = {
        isPro: { booleanValue: true },
        proExpiresAt: { timestampValue: finalExpiryDate.toISOString() }
    };

    // Store Stripe Customer ID for future renewal lookups
    if (stripeCustomerId) {
        updateMask += '&updateMask.fieldPaths=stripeCustomerId';
        fields.stripeCustomerId = { stringValue: stripeCustomerId };
    }

    // Store Subscription Type (recurring vs lifetime)
    if (subscriptionType) {
        updateMask += '&updateMask.fieldPaths=subscriptionType';
        fields.subscriptionType = { stringValue: subscriptionType };
    }

    const url = `${baseUrl}/users/${uid}?${updateMask}`;

    const body = { fields };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firestore API Error ${res.status}: ${text}`);
    }

    const result = await res.json();

    // Record the grant marker before the best-effort mirror writes below. If
    // this fails the webhook returns 500 and Stripe retries; both writes are
    // idempotent.
    await recordStripeState(env, token, uid, {
        eventCreated: eventCreated || Math.floor(Date.now() / 1000),
        grant: true,
        subscriptionId
    });

    // --- SYNC TO config/supporters ---
    // Try to get the email for this user and add them to the supporters list
    try {
        const email = await getEmailForUid(env, uid, token);
        if (email) {
            await addToSupportersConfig(env, token, email, finalExpiryDate, subscriptionType === 'lifetime');
            console.log(`Added ${email} to config/supporters (expires: ${finalExpiryDate.toISOString()})`);
        } else {
            console.warn(`Could not find email for ${uid}, skipping config/supporters sync`);
        }
    } catch (e) {
        console.warn("Failed to sync to config/supporters:", e.message);
    }

    // --- SYNC PRO CUSTOM CLAIM ---
    try {
        await setFirebaseCustomClaims(env, uid, { pro: true });
        console.log(`Set pro=true custom claim for UID: ${uid}`);
    } catch (e) {
        console.warn("Failed to set pro custom claim:", e.message);
    }

    return { status: 'ok', uid: uid };
}

// --- EXTEND SUBSCRIPTION BY CUSTOMER ID ---
async function extendSubscriptionByCustomerId(env, stripeCustomerId, { days = null, expiresAt = null, eventCreated = null, subscriptionId = null, uid = null } = {}) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    let resolvedUid = uid || null;

    if (!resolvedUid) {
        if (!stripeCustomerId) return { status: 'user_not_found' };
        // Query Firestore for user with matching stripeCustomerId
        const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

        const queryBody = {
            structuredQuery: {
                from: [{ collectionId: 'users' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'stripeCustomerId' },
                        op: 'EQUAL',
                        value: { stringValue: stripeCustomerId }
                    }
                },
                limit: 1
            }
        };

        const queryRes = await fetch(queryUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(queryBody)
        });

        if (!queryRes.ok) {
            const text = await queryRes.text();
            throw new Error(`Firestore Query Error ${queryRes.status}: ${text}`);
        }

        const results = await queryRes.json();
        if (results && results.length > 0 && results[0].document) {
            resolvedUid = results[0].document.name.split('/').pop();
        }
    }

    if (!resolvedUid) {
        console.warn(`No user found with stripeCustomerId: ${stripeCustomerId}`);
        return { status: 'user_not_found' };
    }

    const written = await updateFirestoreUser(env, resolvedUid, {
        days,
        expiresAt,
        stripeCustomerId,
        eventCreated,
        subscriptionId
    });
    if (written && written.status === 'user_not_found') return written;
    console.log(`Renewed subscription for UID: ${resolvedUid}`);
    return { status: 'renewed', uid: resolvedUid };
}

// --- REVOKE PRO BY CUSTOMER ID ---
async function revokeProByCustomerId(env, stripeCustomerId, { eventCreated = null, subscriptionId = null, periodEnd = null, uid = null } = {}) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    let resolvedUid = uid || null;
    let userFields = null;

    if (resolvedUid) {
        const getRes = await fetch(`${baseUrl}/users/${resolvedUid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (getRes.status === 404) return { status: 'user_not_found' };
        if (!getRes.ok) {
            const text = await getRes.text();
            throw new Error(`Firestore User Error ${getRes.status}: ${text}`);
        }
        const doc = await getRes.json();
        userFields = doc.fields || {};
    } else {
        if (!stripeCustomerId) return { status: 'user_not_found' };
        // Query Firestore for user with matching stripeCustomerId
        const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

        const queryBody = {
            structuredQuery: {
                from: [{ collectionId: 'users' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'stripeCustomerId' },
                        op: 'EQUAL',
                        value: { stringValue: stripeCustomerId }
                    }
                },
                limit: 1
            }
        };

        const queryRes = await fetch(queryUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(queryBody)
        });

        if (!queryRes.ok) {
            const text = await queryRes.text();
            throw new Error(`Firestore Query Error ${queryRes.status}: ${text}`);
        }

        const results = await queryRes.json();
        if (results && results.length > 0 && results[0].document) {
            resolvedUid = results[0].document.name.split('/').pop();
            userFields = results[0].document.fields || {};
        }
    }

    if (!resolvedUid) {
        console.warn(`No user found with stripeCustomerId: ${stripeCustomerId} to revoke.`);
        return { status: 'user_not_found' };
    }

    const proExpiresAt = userFields && userFields.proExpiresAt && userFields.proExpiresAt.timestampValue
        ? new Date(userFields.proExpiresAt.timestampValue).getTime()
        : 0;

    // A retried event from before an outage must not revoke a newer payment.
    const state = await getStripeState(env, token, resolvedUid);
    const staleReason = staleRevocationReason(state, { eventCreated, subscriptionId, periodEnd, proExpiresAt });
    if (staleReason) {
        console.warn(`Ignoring stale revoke (${staleReason}) for UID ${resolvedUid}`, {
            eventCreated, subscriptionId, periodEnd
        });
        await recordStripeState(env, token, resolvedUid, { eventCreated, grant: false });
        return { status: 'stale', reason: staleReason, uid: resolvedUid };
    }

    // Revoke Access: set isPro to false and expiry to now
    const updateUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${resolvedUid}?updateMask.fieldPaths=isPro&updateMask.fieldPaths=proExpiresAt`;

    const body = {
        fields: {
            isPro: { booleanValue: false },
            proExpiresAt: { timestampValue: new Date().toISOString() }
        }
    };

    const res = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firestore Revoke Error ${res.status}: ${text}`);
    }

    await recordStripeState(env, token, resolvedUid, { eventCreated, grant: false });

    // --- REMOVE FROM config/supporters ---
    try {
        const email = await getEmailForUid(env, resolvedUid, token);
        if (email) {
            await removeFromSupportersConfig(env, token, email);
            console.log(`Removed ${email} from config/supporters`);
        }
    } catch (e) {
        // config/supporters is an authorization source in firestore.rules
        // (isProUser checks it), so a silent failure would leave the user Pro
        // after a cancellation. Fail the webhook and let Stripe retry.
        console.warn("Failed to remove from config/supporters:", e.message);
        throw e;
    }

    // --- REVOKE PRO CUSTOM CLAIM ---
    try {
        await setFirebaseCustomClaims(env, resolvedUid, { pro: false });
        console.log(`Removed pro custom claim for UID: ${resolvedUid}`);
    } catch (e) {
        // A stale pro=true claim can keep social/RTDB paths Pro; retry.
        console.warn("Failed to revoke pro custom claim:", e.message);
        throw e;
    }

    console.log(`Revoked Pro status for UID: ${resolvedUid} due to cancellation/refund.`);
    return { status: 'revoked', uid: resolvedUid };
}

// --- VERIFY FIREBASE ID TOKEN ---
async function verifyFirebaseIdToken(env, idToken) {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');

    function b64decode(str) {
        const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        return JSON.parse(atob(padded));
    }

    const header = b64decode(parts[0]);
    const payload = b64decode(parts[1]);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error('Token expired');
    if (payload.aud !== env.FIREBASE_PROJECT_ID) throw new Error('Invalid audience');
    if (payload.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new Error('Invalid issuer');

    const keys = await getGoogleJwks();

    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error('Unknown signing key');

    const cryptoKey = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['verify']
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) throw new Error('Invalid token signature');

    return payload.sub;
}

// --- GOOGLE AUTH (Service Account JWT) ---
async function getGoogleAccessToken(env) {
    if (googleTokenCache.token && googleTokenCache.expiresAt > Date.now()) {
        return googleTokenCache.token;
    }
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKeyPEM = env.FIREBASE_PRIVATE_KEY; // Expects standard PEM format with \n or literal newlines

    if (!clientEmail || !privateKeyPEM) throw new Error("Missing Firebase credentials");

    // Robust extraction: Find the content BETWEEN the headers, ignoring everything else.
    // 1. Unescape literal newlines from CLI input
    let normalizedPem = privateKeyPEM.replace(/\\n/g, '\n');

    // 2. Regex pull body
    const match = normalizedPem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);

    let privateKeyBody = "";
    if (match) {
        privateKeyBody = match[1];
    } else {
        // Fallback: Assume the whole string might be the body if headers are missing
        // or if headers are malformed.
        console.warn("Debug: Headers not found in regex. Trying raw body cleanup.");
        privateKeyBody = normalizedPem
            .replace(/-----BEGIN PRIVATE KEY-----/g, "")
            .replace(/-----END PRIVATE KEY-----/g, "");
    }

    // Remove all whitespace
    privateKeyBody = privateKeyBody.replace(/\s+/g, '');

    const binaryKey = str2ab(atob(privateKeyBody));

    let key;
    try {
        key = await crypto.subtle.importKey(
            "pkcs8",
            binaryKey,
            {
                name: "RSASSA-PKCS1-v1_5",
                hash: "SHA-256",
            },
            false,
            ["sign"]
        );
    } catch (e) {
        throw new Error(`ImportKey Failed. Key Size: ${binaryKey.byteLength} bytes. Err: ${e.message}`);
    }

    const header = {
        alg: "RS256",
        typ: "JWT"
    };

    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const encodedHeader = b64url(JSON.stringify(header));
    const encodedClaim = b64url(JSON.stringify(claim));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;

    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(unsignedToken)
    );

    const signedToken = `${unsignedToken}.${b64url_encode(signature)}`;

    // Exchange JWT for Access Token
    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.append('assertion', signedToken);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error("Google Token Error: " + JSON.stringify(tokenData));

    const expiresIn = Number(tokenData.expires_in) || 3600;
    googleTokenCache.token = tokenData.access_token;
    googleTokenCache.expiresAt = Date.now() + Math.max(60, expiresIn - 120) * 1000;
    return googleTokenCache.token;
}

// --- UTILS ---
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

function b64url(str) {
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function b64url_encode(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return b64url(binary);
}

// --- STRIPE FETCH ---
// Updated to match scripts/get_subscribers.js logic (fetching Checkout Sessions)
async function fetchActiveSubscribers(env) {
    if (!env.STRIPE_KEY) throw new Error("Missing STRIPE_KEY env var");

    const subscribers = [];
    let startingAfter = null;
    let hasMore = true;

    // We fetch "complete" checkout sessions to capture both Lifetime (payment) and Recurring (subscription)
    // Note: This lists everyone who has ever paid. It does not verify if a subscription was later cancelled.
    // However, this matches the behavior of the 'get_subscribers.js' script the user referenced.

    while (hasMore) {
        // Expand subscription to get current_period_end
        let url = `https://api.stripe.com/v1/checkout/sessions?status=complete&limit=100&expand[]=data.subscription`;
        if (startingAfter) {
            url += `&starting_after=${startingAfter}`;
        }

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${env.STRIPE_KEY}`
            }
        });

        if (!res.ok) {
            throw new Error(`Stripe API Error: ${res.status} ${await res.text()}`);
        }

        const data = await res.json();
        const list = data.data || [];

        for (const session of list) {
            const uid = session.client_reference_id;
            const email = session.customer_details ? session.customer_details.email : null;

            if (uid) {
                let expiresAt = null; // Unix Timestamp

                if (session.mode === 'payment') {
                    // Lifetime: +100 years from now
                    const now = new Date();
                    now.setFullYear(now.getFullYear() + 100);
                    expiresAt = Math.floor(now.getTime() / 1000);
                } else if (session.subscription && typeof session.subscription === 'object') {
                    // Recurring: Use current_period_end
                    expiresAt = session.subscription.current_period_end;
                } else {
                    // Fallback (shouldn't happen if expanded correctly)
                    expiresAt = session.created + (86400 * 32);
                }

                subscribers.push({
                    uid: uid,
                    email: email,
                    name: session.customer_details ? session.customer_details.name : null,
                    stripeId: session.id, // Session ID
                    type: session.mode === 'payment' ? 'Lifetime' : 'Subscription',
                    amount: session.amount_total,
                    currency: session.currency,
                    created: session.created,
                    expiresAt: expiresAt
                });
            }
        }

        hasMore = data.has_more;
        if (hasMore && list.length > 0) {
            startingAfter = list[list.length - 1].id;
        } else {
            hasMore = false;
        }
    }

    return subscribers;
}

// --- FIREBASE AUTH LOOKUP ---
// Uses Identity Toolkit REST API to resolve UIDs to display names
async function resolveFirebaseUsers(env, uids) {
    const accessToken = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;

    // Identity Toolkit API endpoint for batch user lookup
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            localId: uids
        })
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Identity Toolkit API Error: ${res.status} ${errorText}`);
    }

    const data = await res.json();
    console.log("Identity Toolkit Response:", JSON.stringify(data));
    const users = data.users || [];

    // Create a map for easy lookup
    const result = {};
    for (const user of users) {
        result[user.localId] = {
            uid: user.localId,
            displayName: user.displayName || null,
            email: user.email || null
        };
    }

    // Return in same order as input, with nulls for not found
    return uids.map(uid => result[uid] || { uid, displayName: null, email: null });
}

// --- LOOKUP A SINGLE FIREBASE AUTH USER ---
// Returns null when the uid has no Firebase Auth account. Throws on a transport
// or permission error so the caller retries instead of silently treating an
// outage as "no such user".
async function lookupFirebaseAuthUser(env, uid, existingToken = null) {
    const accessToken = existingToken || await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ localId: [uid] })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Identity Toolkit lookup failed ${res.status}: ${text}`);
    }
    const data = await res.json();
    const user = (data.users || [])[0];
    return user ? { uid: user.localId, email: user.email || null } : null;
}

// --- GET EMAIL FOR UID ---
// Tries Firebase Auth first, then Firestore user doc
async function getEmailForUid(env, uid, existingToken = null) {
    const token = existingToken || await getGoogleAccessToken(env);

    // 1. Try Firebase Auth
    try {
        const resolved = await resolveFirebaseUsers(env, [uid]);
        if (resolved[0] && resolved[0].email) {
            return resolved[0].email;
        }
    } catch (e) {
        console.warn("Firebase Auth lookup failed:", e.message);
    }

    // 2. Fallback to Firestore user doc
    const projectId = env.FIREBASE_PROJECT_ID;
    try {
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const doc = await res.json();
            if (doc.fields && doc.fields.email && doc.fields.email.stringValue) {
                return doc.fields.email.stringValue;
            }
        }
    } catch (e) {
        console.warn("Firestore user lookup failed:", e.message);
    }

    return null;
}

// --- CONFIG/SUPPORTERS (single-field writes) ---
// Both helpers used to GET the whole map, mutate one key and PATCH the map
// back. Two concurrent webhooks (or a bulk sync) would read the same old map
// and the second write dropped the first subscriber. A field mask writes only
// the one email, so concurrent grants cannot clobber each other.
function firestoreFieldPath(key) {
    // Dots are path separators in a Firestore field mask; emails contain them.
    return '`' + String(key).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

async function patchSupporterField(env, token, email, value) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    const mask = encodeURIComponent(firestoreFieldPath(email));

    const body = { fields: {} };
    if (value) body.fields[email] = value;

    let res = await fetch(`${baseUrl}/config/supporters?updateMask.fieldPaths=${mask}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
    });

    if (res.status === 404) {
        // The document does not exist yet: a masked update cannot create it.
        if (!value) return true; // nothing to remove
        res = await fetch(`${baseUrl}/config/supporters`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: body.fields })
        });
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to update config/supporters: ${res.status} ${text}`);
    }
    return true;
}

// Updates config/supporters with this email's expiry.
async function addToSupportersConfig(env, token, email, expiresAt, isLifetime = false) {
    // For lifetime members, use a very far future date (year 2100)
    const finalExpiry = isLifetime ? new Date('2100-01-01T00:00:00Z') : expiresAt;
    return patchSupporterField(env, token, email, {
        mapValue: {
            fields: {
                expiresAt: { timestampValue: finalExpiry.toISOString() },
                isLifetime: { booleanValue: isLifetime }
            }
        }
    });
}

// --- REMOVE FROM CONFIG/SUPPORTERS ---
async function removeFromSupportersConfig(env, token, email) {
    // A masked PATCH that omits the field deletes it; 404 means there was
    // nothing to remove.
    return patchSupporterField(env, token, email, null);
}

// --- BULK SYNC SUPPORTERS ---
// Overwrites/Updates config/supporters with the provided list of resolved users
async function bulkSyncSupporters(env, users) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    const fields = {};
    for (const user of users) {
        // Use EMAIL as the key
        if (!user.email) continue;

        let expiresAt;
        if (user.type === 'lifetime' || user.isLifetime) {
            expiresAt = "2100-01-01T00:00:00Z";
        } else {
            // Ensure expiresAt is ISO string
            expiresAt = user.expiresAt ? new Date(user.expiresAt).toISOString() : new Date().toISOString();
        }

        fields[user.email] = {
            mapValue: {
                fields: {
                    expiresAt: { timestampValue: expiresAt },
                    isLifetime: { booleanValue: user.type === 'lifetime' || user.isLifetime }
                }
            }
        };
    }

    // Note: This does NOT clear old keys (username keys will persist until manually removed)
    // To fix that, we would need to read the existing doc, filter out non-emails, or do a full replace.
    // For safety, we will merge (PATCH), but the user might want a full cleanup later.

    const res = await fetch(`${baseUrl}/config/supporters`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });

    if (!res.ok) {
        throw new Error(`Bulk Sync Error: ${res.status} ${await res.text()}`);
    }

    return { status: 'success', count: Object.keys(fields).length };
}

// --- GET FIREBASE CUSTOM CLAIMS ---
// `accounts:update.customAttributes` replaces the whole claims object, so we
// must read the current claims and merge before writing.
async function getFirebaseCustomClaims(env, uid) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ localId: [uid] })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Custom Claims Lookup Error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const users = data.users || [];
    if (!users.length) return {};

    const raw = users[0].customAttributes;
    if (!raw) return {};

    try {
        return JSON.parse(raw) || {};
    } catch (e) {
        throw new Error('Could not parse existing custom claims.');
    }
}

// --- SET FIREBASE CUSTOM CLAIMS ---
// Uses the Identity Toolkit REST API to set custom claims on a user's auth token
async function setFirebaseCustomClaims(env, uid, claims, options) {
    const replace = options && options.replace === true;
    const existing = replace ? {} : await getFirebaseCustomClaims(env, uid);
    const merged = mergeClaims(existing, claims);
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;

    // Identity Toolkit v1: accounts:update with customAttributes
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            localId: uid,
            customAttributes: JSON.stringify(merged)
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Custom Claims Error ${res.status}: ${text}`);
    }

    return await res.json();
}

// --- BULK SYNC PRO CLAIMS ---
// Iterates all users in Firestore, checks pro status, and sets custom claims accordingly
async function bulkSyncProClaims(env) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    // 1. Load supporters config
    let supporters = {};
    try {
        const suppRes = await fetch(`${baseUrl}/config/supporters`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (suppRes.ok) {
            const suppDoc = await suppRes.json();
            if (suppDoc.fields) {
                for (const [email, value] of Object.entries(suppDoc.fields)) {
                    if (value.mapValue && value.mapValue.fields && value.mapValue.fields.expiresAt) {
                        supporters[email] = value.mapValue.fields.expiresAt.timestampValue;
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Could not load supporters config:", e.message);
    }

    // 2. Query all user docs
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const queryBody = {
        structuredQuery: {
            from: [{ collectionId: 'users' }],
            limit: 500
        }
    };

    const queryRes = await fetch(queryUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(queryBody)
    });

    if (!queryRes.ok) {
        throw new Error(`Firestore Query Error: ${queryRes.status}`);
    }

    const results = await queryRes.json();
    let updated = 0;
    let proCount = 0;
    let errors = 0;

    for (const result of results) {
        if (!result.document) continue;

        const docPath = result.document.name;
        const uid = docPath.split('/').pop();
        const fields = result.document.fields || {};
        let isPro = false;

        // Check proExpiresAt
        if (fields.proExpiresAt && fields.proExpiresAt.timestampValue) {
            const expiresAt = new Date(fields.proExpiresAt.timestampValue).getTime();
            if (expiresAt > Date.now()) {
                isPro = true;
            }
        }

        // Check supporters by email
        if (!isPro) {
            try {
                const resolved = await resolveFirebaseUsers(env, [uid]);
                const email = resolved[0]?.email;
                if (email && supporters[email]) {
                    const expiry = new Date(supporters[email]).getTime();
                    if (expiry > Date.now()) {
                        isPro = true;
                    }
                }
            } catch (e) {
                // Skip
            }
        }

        // Set claim
        try {
            await setFirebaseCustomClaims(env, uid, { pro: isPro });
            updated++;
            if (isPro) proCount++;
        } catch (e) {
            errors++;
            console.warn(`Failed to set claims for ${uid}: ${e.message}`);
        }
    }

    return { status: 'success', updated, proCount, errors };
}
