export default {
    async fetch(request, env, ctx) {
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

    return await res.json();
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
        scope: "https://www.googleapis.com/auth/datastore",
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
