/*
 * Pure helpers for the Stripe webhook, kept out of worker.js so they can be
 * unit-tested (scripts/test-stripe-events.js).
 *
 * Why these exist: Stripe retries failed deliveries for up to 3 days and does
 * not guarantee ordering. A retried `customer.subscription.deleted` (or
 * `charge.refunded`) from before an outage can arrive *after* a newer
 * checkout/renewal and would otherwise revoke the customer's new Pro period.
 * The worker keeps `stripe_state/{uid}` (server-only) with the newest grant
 * event time and subscription id so these stale events can be ignored.
 */

// Stripe timestamps are unix seconds. Fall back to "now" only if a malformed
// event somehow gets past signature verification.
export function eventSeconds(event) {
    const n = Number(event && event.created);
    return Number.isFinite(n) && n > 0 ? n : Math.floor(Date.now() / 1000);
}

export function subscriptionIdOf(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.id === 'string') return value.id;
    return null;
}

// New checkouts carry metadata.uid on the Checkout Session (metadata) and on
// the Subscription (`subscription_data[metadata][uid]`). Reading it means a
// renewal can still find the user when checkout.session.completed was lost.
export function uidFromSubscription(subscription) {
    if (!subscription) return null;
    const meta = subscription.metadata;
    if (meta && typeof meta.uid === 'string' && meta.uid) return meta.uid;
    return null;
}

export function uidFromInvoice(invoice) {
    if (!invoice) return null;
    const direct = invoice.subscription_details && invoice.subscription_details.metadata;
    if (direct && typeof direct.uid === 'string' && direct.uid) return direct.uid;
    const parent = invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.metadata;
    if (parent && typeof parent.uid === 'string' && parent.uid) return parent.uid;
    const line = invoice.lines && invoice.lines.data && invoice.lines.data[0] && invoice.lines.data[0].metadata;
    if (line && typeof line.uid === 'string' && line.uid) return line.uid;
    return null;
}

/*
 * Returns a reason string when a revoke event must be ignored, or null when it
 * should be applied.
 *
 *   state: { lastGrantAt: seconds, subscriptionId: string }
 *   opts:  { eventCreated: seconds, subscriptionId, periodEnd: seconds,
 *            proExpiresAt: ms }
 */
export function staleRevocationReason(state, opts) {
    const s = state || {};
    const o = opts || {};

    if (o.eventCreated && s.lastGrantAt && o.eventCreated < s.lastGrantAt) {
        return 'older_than_last_grant';
    }
    if (o.subscriptionId && s.subscriptionId && o.subscriptionId !== s.subscriptionId) {
        return 'different_subscription';
    }
    // Legacy users have no state. If their current expiry is comfortably past
    // the deleted subscription's paid period, a newer subscription is active.
    // Only use this when there is no state: a stateful user is protected by
    // lastGrantAt/subscriptionId, and a late-processed checkout can legitimately
    // leave proExpiresAt a few days past current_period_end.
    if (!s.lastGrantAt && !s.subscriptionId &&
        o.periodEnd && o.proExpiresAt && o.proExpiresAt > (o.periodEnd + 3 * 86400) * 1000) {
        return 'newer_expiry';
    }
    return null;
}

// Merge timestamps monotonically. A stale grant must never lower the marker,
// otherwise the next stale revoke would be applied.
export function nextState(state, opts) {
    const s = state || {};
    const o = opts || {};
    const eventAt = Number(o.eventCreated) || 0;
    return {
        lastEventAt: Math.max(Number(s.lastEventAt) || 0, eventAt),
        lastGrantAt: Math.max(Number(s.lastGrantAt) || 0, o.grant ? eventAt : 0),
        subscriptionId: (o.grant && o.subscriptionId) ? o.subscriptionId : (s.subscriptionId || '')
    };
}
