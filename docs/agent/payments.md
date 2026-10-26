# Payments, Stripe webhooks and post-outage reconciliation

Scope: `workers/rekindle-stripe/`, `pay.html`, `admin/reconcile_stripe.js`,
`firebase-functions/account-deletion.js`, and the Firestore/RTDB data they write.
Read this before changing anything that grants or revokes ReKindle+.

## 2026-10-25 Workers Free blackout (what actually happened)

The account hit Cloudflare's Workers Free daily cap. The socials were split onto
a second account late in the incident, but **the main account was down too**,
which means payments were down. The accurate window from Cloudflare GraphQL
(`workersInvocationsAdaptive`, account `264c1185a9930ff6d69502c0c9c6bfd7`):

| Time (UTC) | Observation |
| :--- | :--- |
| 15:15:20 | last successful `rekindle-stripe` request (a webhook, 13 subrequests) |
| 16:00–22:00 | **every** main-account script has zero invocations (stripe, reader, kpm, moderate, translate, …) |
| ~22:50 | social Workers moved to the ReKindle Social account (socials recover) |
| 23:09:25 | first successful `rekindle-stripe` request after the blackout |
| 23:12–23:20 | four webhook deliveries (11–13 subrequests each), including three checkout/period grants |

`rekindle-stripe` had **118 requests / 0 execution errors** on Oct 25; the 1027
responses never reach the Worker, so they do not appear in that count. The
early recovery at 23:09Z is **before** the documented 00:00Z quota reset; the
likely explanation is a plan change/manual reset. Confirm the current Cloudflare
plan before assuming the 100k/day cap is gone.

### Did purchases/cancellations get lost?

No evidence of loss, and the mechanism is self-healing:

- **New purchases could not start while the Worker was down.** `pay.html`
  creates the Checkout Session through `POST /create-checkout`; a 1027 response
  shows "Error — please refresh". So nobody could be charged for a session that
  was never created.
- **Checkout sessions created before the blackout, renewals, portal
  cancellations and refunds were delivered as webhooks.** Stripe retries failed
  deliveries for up to 3 days with exponential backoff
  ([Stripe docs](https://docs.stripe.com/events/manage-webhook-endpoints.md#process-undelivered-events)),
  so an ~8 hour outage is inside the retry window.
- The post-recovery burst above is consistent with those retries landing. One
  renewal's `proExpiresAt` was `period_end + 2 days` and its document was written
  at 23:12Z, i.e. roughly an hour after the invoice period started; the 2-day
  grace kept access continuous.
- **No revocations were applied in the recovery window** (no linked user has
  `isPro=false` with a `proExpiresAt` at 23:0x–23:2x). A cancellation retried
  later would still revoke correctly; a cancellation webhook that arrived before
  a new checkout is the dangerous ordering case fixed below.

The real historical anomaly was different: **30 of 321 Stripe-linked users had
`isPro: true` with an expired `proExpiresAt`**, and they were **yearly
subscribers whose annual invoice was silently ignored** (see the next section),
not missed cancellations. The 32-day expiry was the checkout grant; the annual
invoice would have granted a year, but the handler skipped it and returned 200.
They were repaired on 2026-10-26. One supporter with a `config/supporters` entry
but no `users/{uid}` document remains for manual review.

**The authoritative check is Stripe, not Firestore.** Stripe's Workbench →
Webhooks → Event deliveries shows `Delivered` / `Pending` / `Failed`; the List
Events API can return only failed deliveries for a window:

```
GET https://api.stripe.com/v1/events
  ?created[gte]=<outage start>
  &delivery_success=false
  &types[]=checkout.session.completed
  &types[]=invoice.payment_succeeded
  &types[]=customer.subscription.updated
  &types[]=customer.subscription.deleted
  &types[]=charge.refunded
```

`admin/reconcile_stripe.js` wraps that check plus a full Firestore comparison;
see the runbook below.

## 2026-10-26: yearly subscribers only got 32 days (fixed)

This is separate from the outage and explains the 30 stale `isPro` records.

- 30 **active** yearly subscribers (`price_1StGmz…`, $15/year) had
  `proExpiresAt` exactly 32 days after checkout, then expired. Some had been
  expired since March 2026 while still being billed.
- Root cause: `invoice.payment_succeeded` did
  `if (invoice.subscription && …)`. In Stripe's current API that field is
  **absent** on the event; the subscription is at
  `invoice.parent.subscription_details.subscription` (and the line's
  `parent.subscription_item_details.subscription`). The handler fell through to a
  200 "Received" and Stripe never retried. Monthly plans were rescued by
  `customer.subscription.updated` at every renewal; yearly plans only get that
  update at the anniversary, so they lapsed after the checkout's 32-day buffer.
- Fix: resolve the subscription from the top-level field, `parent`, or the line
  parent; choose the invoice line that belongs to that subscription; and return
  500 if no period end is present. Regression test:
  `scripts/test-stripe-webhook.js` (annual invoice case).
- Repair (2026-10-26): `node admin/reconcile_stripe.js --fix-grants` repaired 32
  users (30 yearly + 2 shorter monthly edge cases): `proExpiresAt` set to
  `period_end + 2d`, `config/supporters` updated, `pro` claim merged. The rerun
  reported `paidNotPro: 0`, `supporters-only: 1`, and the two pending events.
  The affected UIDs/customers/expiries are in
  `admin/backups/stripe-pro-repair-2026-10-26.csv`.
- **Not repaired:** yearly subscribers who churned after lapsing. They paid for
  a year and received ~32 days; refunds/goodwill are a business decision. Query
  `status=canceled` yearly subscriptions to find them.
- The two events still pending from the outage are
  `evt_1UUVIpAetQspKPuSG7nIV4bW` (`customer.subscription.updated`, the
  `FlM5OdFP…` monthly renewal) and `evt_1UUU53AetQspKPuS0IXKzR9j`
  (`invoice.payment_succeeded`, `gJrFj1Qc…`, already applied). Both users are
  now Pro; the retries are idempotent. Resend them from Workbench to clear the
  pending count, or let Stripe's 3-day schedule finish.

## 2026-10-26: a brand-new payer never got Pro (fixed)

The report was "a user who just bought Pro did not get Pro status, and I cannot
even grant Pro from moderation.html". Both failures were the same missing
document.

**A `users/{uid}` document is not created at sign-up.** It appears the first
time someone saves a setting (or a favourite, `settings.html`, etc.). On
2026-10-26 a US buyer created an account and bought the **$30 lifetime** plan
one minute later (`edgarmr@rekindle.ink`, uid `WKMMWknuWGMgBaqowLf0cowuoVo2`,
`evt_1UUiIQAetQspKPuSp1KA1sKw`, 07:25Z), so the account had no document:

* The Stripe worker read `users/{uid}`, got 404, and returned
  `user_not_found`. The webhook answered **500**, Stripe retried for three days
  and then stopped. Nothing (`isPro`, `config/supporters`, `pro` claim,
  `stripe_state`) was ever written. Roughly **4,250 accounts active in the last
  30 days have no `users/{uid}` document**, so this was never a one-off.
* The console's "Grant Pro" wrote the same document from the browser. For a
  missing document that is a **create**, and the `match /users/{userId}` create
  rule had no owner escape — only owner-self creation with `isPro` forbidden.
  The owner's write failed with `Missing or insufficient permissions`. The
  update path was allowed, which is why manual grants only ever worked for
  users who already had a document.

**Fix (all three deployed 2026-10-26):**

1. `workers/rekindle-stripe/worker.js` — on a 404 the worker now asks Firebase
   Auth (`lookupFirebaseAuthUser`) whether the uid is a real account. If it is,
   the grant continues and the PATCH creates the document with just the
   entitlement fields; only a uid with no Auth account is `user_not_found`.
   Throws (→ Stripe retry) on an Auth lookup failure, so an outage cannot look
   like a bogus uid. `scripts/test-stripe-webhook.js` case 5 covers it.
2. `firestore.rules` — the `/users/{userId}` **create** rule now has the
   `isDeveloper()` branch, so an owner-side console write can create the
   document. Self-create still may not set `isPro`/`proExpiresAt`.
3. `adminSetPro` (functions/index.js, owner-only onCall) — the console's
   Grant/Revoke now goes through the Admin SDK, which upserts the document,
   updates `config/supporters` and **merges** the `pro` custom claim in one
   call. The browser write remains as a fallback only. That claim matters:
   `storage.rules` checks `request.auth.token.pro`, and the old direct write
   never updated it. `scripts/test-pro-grant.js` guards all three.

**Repair:** the buyer was granted lifetime Pro (expiry `now + 36500d`, matching
the worker's `mode=payment` term), added to `config/supporters`, given the
merged `pro` claim, and `stripe_state/{uid}` was seeded with the checkout event
time so later ordering checks behave as if the webhook had succeeded. Row in
`admin/backups/pro-repair-2026-10-26-docless-buyer.csv`.

**Finding future cases:** a doc-less payer leaves **no trace in Firestore** —
no document, no supporters entry, no `stripe_state` — so the only source is
Stripe. `GET /v1/events?created[gte]=…&delivery_success=false` over 90 days
returned exactly two events on 2026-10-26: this checkout and the
`FlM5OdFP…` renewal that was already applied. Use that query to audit any
repeat; the buyer's `client_reference_id` / `metadata.uid` is the uid to repair.

## Pro entitlement audit (read-only, 2026-10-26)

`node admin/audit_pro_entitlements.js` compares every effective Pro user with
Firestore, Stripe subscriptions/lifetime Checkout Sessions, `config/supporters`,
and the Auth `pro` claim. It never writes. Result on 2026-10-26:

| Bucket | Count | Meaning |
| :--- | ---: | :--- |
| paid-active | 195 | active/trialing Stripe subscription |
| paid-lifetime | 168 | completed payment-mode Checkout Session |
| manual | 2 | `subscriptionType: manual` (intentional comp) |
| lifetime-comp | 3 | lifetime type, no Stripe payment found (intentional comp) |
| past-due-still-pro | 1 | renewal failed, still inside the paid period + 2d |
| no-payment-evidence | 0 | Pro with no customer/type/supporter |
| recurring-no-active-sub | 0 | Pro + customer but no active sub |
| supporter-comp | 0 | Pro only via `config/supporters` with a user doc |
| stale-isPro | 0 | `isPro: true` but expired |
| stale pro claim | 2 | claim true, no user document (ghost accounts) |
| supporter-only | 1 | future supporters entry, no effective user Pro |

There is **no unexplained free Pro**: every effective user is either paying, an
explicit `manual`/`lifetime` comp, or the one past-due user who is still inside
the period they paid for. The two ghosts have Auth claims/supporters entries but
no `users/{uid}` document, so `pro-gate.js` (which reads the user document) does
not grant them app access; review them manually. The 2 manual + 3 lifetime comps
are the kind of admin grants the owner remembers making.

CSV (all rows, review categories marked):
`admin/backups/pro-entitlement-audit-2026-10-26.csv`.

## What the Worker used to get wrong (and now does not)

1. **Retried revocations could wipe a newer subscription.** Stripe does not
   guarantee event ordering, and a retried `customer.subscription.deleted` /
   `charge.refunded` from before the outage can arrive after a re-subscribe.
   The old code revoked by customer id unconditionally, setting
   `proExpiresAt = now`.
   Fix: `stripe_state/{uid}` (server-only, default-deny) stores `lastEventAt`,
   `lastGrantAt` and `subscriptionId`. `staleRevocationReason()` in
   `events.js` ignores a revoke that is older than the newest grant, is for a
   different subscription, or (legacy users with no state) would revoke an
   expiry more than 3 days past the deleted subscription's period end.
2. **Retried grants could resurrect cancelled Pro.** A stale
   `checkout.session.completed` is ignored when its `event.created` is older
   than the newest processed event. It compares `lastEventAt`, **not**
   `lastGrantAt`: a yearly checkout and its renewal invoice can share a second,
   and the invoice is what carries the real 365-day period.
3. **A missing `client_reference_id` / customer was silently returned as 200.**
   Stripe stops retrying after a 2xx, so that was a permanent silent loss. Known
   events with no resolvable user now return 500 (visible in Stripe, retried).
4. **`checkout.session.completed` was the only place `stripeCustomerId` was
   written.** If that one event was lost, every future renewal returned
   `user_not_found` forever. New checkouts now set `metadata[uid]` and
   `subscription_data[metadata][uid]` (or `payment_intent_data` for lifetime);
   `invoice.payment_succeeded`, `customer.subscription.updated` and
   `customer.subscription.deleted` fall back to that uid, and renewals repair
   `stripeCustomerId`.
5. **An unknown uid created a partial `users/{uid}` document.** A 404 from the
   user read used to be treated as a bogus uid, but a missing document is normal
   for a first purchase (see the 2026-10-26 section). The worker now confirms
   the uid with Firebase Auth, writes the grant if the account is real, and
   returns `user_not_found` only when Auth has no such account; a read error
   still throws so Stripe retries.
6. **Partial refunds revoked Pro.** `charge.refunded` now only revokes a fully
   refunded charge (`refunded === true` / `amount_refunded >= amount`).
7. **A failed `config/supporters` removal was swallowed.** Firestore rules treat
   that document as an authorization source, so the user kept Pro after a
   cancellation. The revoke path now throws, so Stripe retries. The same applies
   to the custom-claim revoke.
8. `GET /health` returns `{ ok, stripeKey, firebase }` without secrets, so an
   uptime monitor can distinguish "up" from a 1027 page.
9. **Yearly invoices were ignored** because they no longer carry a top-level
   `invoice.subscription`; see the annual-subscriber section above.

Tests: `node scripts/test-stripe-events.js` (wired into `npm test`) covers the
pure ordering helpers and the source guards. The worker can be bundled with
`cd workers/rekindle-stripe && npx wrangler deploy --dry-run`.

## Other Cloudflare Workers with permanent effects

| Worker | Permanent side effect | If it is unreachable |
| :--- | :--- | :--- |
| `rekindle-stripe` | Firestore `isPro`/`proExpiresAt`, supporters, claims | Stripe retries 3 days; no new checkout can start; run the reconciliation script after recovery |
| `rekindle-moderate` | chat/topics/posts/comments/DMs/reports, moderation logs, rate-limit buckets, auto-delete | fail-closed: the request never reaches the Worker, clients keep the draft and show the outage message; no partial write from a 1027 |
| `rekindle-translate` | `kindlechat/translations_by_lang/{lang}/{msgId}` PUTs | idempotent per language; the chat message still posts; translation is retried or missing until a later request |
| `story-server` | KV `game:` / `state:` / `log:` (Z-machine saves) | a command fails, state is not advanced; the user can retry |
| `rekindle-readwise` | forwards `/review` POST to Readwise (external) | user sees an error; a response lost after Readwise accepted can duplicate a review |
| `rekindle-pinterest` | Pinterest OAuth code exchange / refresh (external) | connection attempt fails; the Firestore token is written by the client, not this Worker |
| `rekindle-reader`, `rekindle-kpm`, `rekindle-tmdb`, `rekindle-chords`, `rekindle-oracle`, `rekindle-ocr`, `rekindle-substack`, `rekindle-akinator` | read-only proxies / edge caches | app shows an error; nothing persistent is written |
| Pages Functions (`functions/api/*`) | edge cache only (`caches.default`) | apps show an error; no persistent effect |

The social Worker is the only other place where a user action is a permanent
write, and it is deliberately fail-closed. The 2026-10-25 outage therefore lost
social *attempts* (a report or post the user did not retry), not stored data.

## Runbook: after any Cloudflare/Worker outage

1. `curl -s https://rekindle-stripe.timjarnott.workers.dev/health` — expect
   `{"ok":true,...}`. A `429` `error code: 1027` means the account cap is back.
2. Stripe Workbench → Webhooks → endpoint → **Event deliveries**, filter
   `Failed`/`Pending` for the outage window; resend anything still failed.
3. Run the reconciler read-only:
   ```bash
   STRIPE_KEY=sk_live_... node admin/reconcile_stripe.js --since 2026-10-25T15:00:00Z
   ```
   It reports paid-but-not-Pro, cancelled/refunded-but-still-Pro,
   supporters-only Pro and any `delivery_success=false` / pending events. It
   never writes without `--fix-grants` / `--fix-revocations`.
   The restricted key needs **Events Read**, **Subscriptions Read** and
   **Checkout Sessions Read** (`checkout_session_read`). Without the last one it
   logs `skipped: the Stripe key lacks checkout_session_read` and still checks
   active subscriptions and events.
4. Spot-check a recent payer: `users/{uid}.proExpiresAt` is in the future and
   `config/supporters[email].expiresAt` matches.
5. If claims look stale for a broad group, `/sync-pro-claims` exists but is
   **not** a full sweep — `bulkSyncProClaims` has `limit: 500` and the Worker
   Free subrequest limit makes a 7k-user pass impossible in one invocation.
   Treat it as a small backfill, not a reconciliation tool.

## Open items

- No durable `stripe_events/{eventId}` log/dedupe yet. The reconciler and the
  Stripe dashboard cover auditability today; add per-event logging if duplicate
  deliveries or silent drops reappear.
- `charge.refunded` resolves the user by customer only; a refund of an *old*
  charge after a newer subscription still relies on the `lastEventAt` guard.
  Mapping the refund to its invoice/subscription would be stricter.
- `bulkSyncProClaims` (`limit: 500`) and `fetchActiveSubscribers` (lists every
  completed Checkout Session, not currently active subscriptions) are
  admin-only tools with misleading names; do not use them to judge who is Pro.
- `deleteAccount` only cancels Stripe subscriptions when `STRIPE_KEY` is set in
  `firebase-functions/.env`; it is not set. Until it is, a user who deletes
  their account without cancelling first keeps getting billed.
- `config/supporters` is readable by any authenticated user
  (`firestore.rules:452`), so every supporter's email is exposed. If pro-gate
  should fall back to it for supporters-only users, do that server-side first.
- The legacy `isPro` boolean is not maintained when an expiry lapses; nothing
  authorizes on it, but it is shown in moderation UI and the privacy page.
