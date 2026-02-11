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
        try {
            if (event.type === 'checkout.session.completed') {
                // NEW SUBSCRIPTION or ONE-TIME PAYMENT
                const session = event.data.object;
                const uid = session.client_reference_id;
                const stripeCustomerId = session.customer;

                if (uid) {
                    // Check Mode: 'payment' = Lifetime, 'subscription' = Recurring
                    let days = 32; // Default subscription buffer
                    let subscriptionType = 'recurring';

                    if (session.mode === 'payment') {
                        days = 36500; // Lifetime (100 years)
                        subscriptionType = 'lifetime';
                    }

                    await updateFirestoreUser(env, uid, { days, stripeCustomerId, subscriptionType });
                    return new Response(`Success: New ${session.mode} activated`, { status: 200 });
                } else {
                    console.warn("No client_reference_id found in session");
                }
            }
            else if (event.type === 'invoice.payment_succeeded') {
                // RENEWAL - Extend subscription
                const invoice = event.data.object;
                const customerId = invoice.customer;

                // SKIP: subscription_update invoices (prorations) often have 'today' as period_end
                if (invoice.billing_reason === 'subscription_update') {
                    return new Response('Skipped subscription_update invoice', { status: 200 });
                }

                // If the invoice is for a subscription (not one-time), extend their access
                if (invoice.subscription && (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_create')) {
                    if (customerId) {
                        // Note: invoice.period_end is for the current bill, but we want the subscription's next expiry.
                        // However, for renewals, invoice.period_end is usually the new expiry.
                        // We'll use 32 days as a safe fallback if we don't have a better source,
                        // but customer.subscription.updated should provide the precise timestamp.
                        const expiresAt = new Date(invoice.lines.data[0].period.end * 1000 + (86400 * 1000 * 2)); // +2 day buffer
                        const result = await extendSubscriptionByCustomerId(env, customerId, { expiresAt });

                        if (result.status === 'user_not_found') {
                            // Retry later if user is not yet linked (race condition with checkout event)
                            return new Response(`Retry: User not found yet for customer ${customerId}`, { status: 500 });
                        }
                        return new Response(`Success: Subscription renewed for UID ${result.uid} (Expires: ${expiresAt.toISOString()})`, { status: 200 });
                    } else {
                        console.warn("No customer ID in invoice for renewal");
                    }
                }
            }
            else if (event.type === 'customer.subscription.updated') {
                // PLAN CHANGE (upgrade/downgrade) or RENEWAL
                const subscription = event.data.object;
                const customerId = subscription.customer;
                let currentPeriodEnd = subscription.current_period_end; // Unix timestamp

                // Fallback: Check items if top-level is missing
                if (!currentPeriodEnd && subscription.items && subscription.items.data && subscription.items.data.length > 0) {
                    currentPeriodEnd = subscription.items.data[0].current_period_end;
                }


                if (customerId && currentPeriodEnd) {
                    // Use the exact period end from Stripe + 2 day buffer
                    const expiresAt = new Date((currentPeriodEnd * 1000) + (86400 * 1000 * 2));
                    const result = await extendSubscriptionByCustomerId(env, customerId, { expiresAt });

                    if (result.status === 'user_not_found') {
                        // Retry later if user is not yet linked
                        return new Response('Retry: User not found yet', { status: 500 });
                    }
                    return new Response(`Success: Subscription updated`, { status: 200 });
                } else {
                    return new Response('Missing customer ID or period end', { status: 200 });
                }
            }
            else if (event.type === 'customer.subscription.deleted') {
                // CANCELLATION
                const subscription = event.data.object;
                const customerId = subscription.customer;

                if (customerId) {
                    await revokeProByCustomerId(env, customerId);
                    return new Response('Success: Subscription cancelled and revoked', { status: 200 });
                } else {
                    console.warn("No customer ID in subscription deletion event");
                }
            }
            else if (event.type === 'charge.refunded') {
                // REFUND - Revoke access immediately
                const charge = event.data.object;
                const customerId = charge.customer;

                if (customerId) {
                    await revokeProByCustomerId(env, customerId);
                    return new Response('Success: Pro status revoked due to refund', { status: 200 });
                } else {
                    console.warn("No customer ID in refund event");
                }
            }
        } catch (e) {
            console.error('Firestore Error:', e);
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

// --- FIRESTORE UPDATE ---
async function updateFirestoreUser(env, uid, { days = null, expiresAt = null, stripeCustomerId = null, subscriptionType = null } = {}) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

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
    try {
        const getRes = await fetch(`${baseUrl}/users/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (getRes.ok) {
            const userDoc = await getRes.json();
            if (userDoc.fields && userDoc.fields.proExpiresAt && userDoc.fields.proExpiresAt.timestampValue) {
                currentExpiry = new Date(userDoc.fields.proExpiresAt.timestampValue).getTime();
            }
        }
    } catch (e) {
        console.warn("Could not fetch user for race-condition check, proceeding with overwrite:", e);
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

    return result;
}

// --- EXTEND SUBSCRIPTION BY CUSTOMER ID ---
async function extendSubscriptionByCustomerId(env, stripeCustomerId, { days = null, expiresAt = null } = {}) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;

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

    // Check if we found a user
    if (results && results.length > 0 && results[0].document) {
        const docPath = results[0].document.name;
        // Extract UID from path: .../users/UID
        const uid = docPath.split('/').pop();

        // Extend their subscription
        await updateFirestoreUser(env, uid, { days, expiresAt });
        console.log(`Renewed subscription for UID: ${uid}`);
        return { status: 'renewed', uid };
    } else {
        console.warn(`No user found with stripeCustomerId: ${stripeCustomerId}`);
        return { status: 'user_not_found' };
    }
}

// --- REVOKE PRO BY CUSTOMER ID ---
async function revokeProByCustomerId(env, stripeCustomerId) {
    const token = await getGoogleAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;

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
        const docPath = results[0].document.name;
        const uid = docPath.split('/').pop();

        // Revoke Access: set isPro to false and expiry to now
        const updateUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=isPro&updateMask.fieldPaths=proExpiresAt`;

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

        // --- REMOVE FROM config/supporters ---
        try {
            const email = await getEmailForUid(env, uid, token);
            if (email) {
                await removeFromSupportersConfig(env, token, email);
                console.log(`Removed ${email} from config/supporters`);
            }
        } catch (e) {
            console.warn("Failed to remove from config/supporters:", e.message);
        }

        // --- REVOKE PRO CUSTOM CLAIM ---
        try {
            await setFirebaseCustomClaims(env, uid, { pro: false });
            console.log(`Removed pro custom claim for UID: ${uid}`);
        } catch (e) {
            console.warn("Failed to revoke pro custom claim:", e.message);
        }

        console.log(`Revoked Pro status for UID: ${uid} due to refund.`);
        return { status: 'revoked', uid };
    } else {
        console.warn(`No user found with stripeCustomerId: ${stripeCustomerId} to revoke.`);
        return { status: 'user_not_found' };
    }
}

// --- GOOGLE AUTH (Service Account JWT) ---
async function getGoogleAccessToken(env) {
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKeyPEM = env.FIREBASE_PRIVATE_KEY; // Expects standard PEM format with \n or literal newlines

    if (!clientEmail || !privateKeyPEM) throw new Error("Missing Firebase credentials");

    // Clean API Key
    console.log("Debug: Raw Key Length", privateKeyPEM.length);
    console.log("Debug: Raw Key Start", privateKeyPEM.substring(0, 30));

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
    console.log("Debug: Extracted Body Start (Fallback)", privateKeyBody.substring(0, 20));

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

    return tokenData.access_token;
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

// --- ADD TO CONFIG/SUPPORTERS ---
// Updates config/supporters document with username and expiry
// --- ADD TO CONFIG/SUPPORTERS ---
// Updates config/supporters document with email and expiry
async function addToSupportersConfig(env, token, email, expiresAt, isLifetime = false) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    // For lifetime members, use a very far future date (year 2100)
    const finalExpiry = isLifetime ? new Date('2100-01-01T00:00:00Z') : expiresAt;

    // We need to update a single field within the map. 
    // Firestore REST API uses field masks with dot notation for nested fields.
    // config/supporters structure: { "email@example.com": { expiresAt: timestamp }, ... }

    // First, get the current document to merge
    let existingData = {};
    try {
        const getRes = await fetch(`${baseUrl}/config/supporters`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (getRes.ok) {
            const doc = await getRes.json();
            if (doc.fields) {
                existingData = doc.fields;
            }
        }
    } catch (e) {
        // Document might not exist yet, that's fine
    }

    // Add/update this user
    existingData[email] = {
        mapValue: {
            fields: {
                expiresAt: { timestampValue: finalExpiry.toISOString() },
                isLifetime: { booleanValue: isLifetime }
            }
        }
    };

    // Write the full document back
    const url = `${baseUrl}/config/supporters`;
    const body = { fields: existingData };

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
        throw new Error(`Failed to update config/supporters: ${res.status} ${text}`);
    }

    return true;
}

// --- REMOVE FROM CONFIG/SUPPORTERS ---
async function removeFromSupportersConfig(env, token, email) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    // Get current document
    let existingData = {};
    try {
        const getRes = await fetch(`${baseUrl}/config/supporters`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (getRes.ok) {
            const doc = await getRes.json();
            if (doc.fields) {
                existingData = doc.fields;
            }
        }
    } catch (e) {
        return; // Nothing to remove
    }

    // Remove this user
    delete existingData[email];

    // Write the document back
    const url = `${baseUrl}/config/supporters`;
    const body = { fields: existingData };

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
        throw new Error(`Failed to update config/supporters: ${res.status} ${text}`);
    }

    return true;
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

// --- SET FIREBASE CUSTOM CLAIMS ---
// Uses the Identity Toolkit REST API to set custom claims on a user's auth token
async function setFirebaseCustomClaims(env, uid, claims) {
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
            customAttributes: JSON.stringify(claims)
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
