# Change Password & the "I forgot my password" reset

Added 2026-10-26. Read before changing `settings.html`'s Change Password box,
`firebase-functions/password-reset.js`, `password-reset-lib.js` or the
`password_reset_limits` / `security_events` nodes.

## What it is

Two paths in one Settings modal (`#password-modal-overlay`):

| Mode | Who | Proof | Minimum |
| :--- | :--- | :--- | :--- |
| **Current** (default) | User remembers the password | `reauthenticateWithCredential()` with the current password, then `updatePassword()` | 6 characters |
| **Forgot** (`Forgot your current password?`) | User is still signed in but cannot recall it | The live Firebase session, plus typing the username, then the `resetForgottenPassword` callable | 8 characters |

Why the second path exists: ReKindle logins are `username@rekindle.ink` and
`registerUser` never collects a real email address, so there is **no email
reset link** to send. Before this, a signed-in user who forgot the password was
permanently locked out (support had to reset it by hand). Help content says so
in `help-data.js` → "Changing your password".

## Security model (the important part)

**The signed-in session is the authority for the forgot path.** That was an
explicit owner decision on 2026-10-26; do not "harden" it by re-adding the
current-password check, because that removes the only recovery path the product
has.

Accepted consequence: anyone who can use the signed-in device, or who holds a
valid ID token (e.g. via XSS), can set a new password only they know and lock
the original owner out. Support can restore access from the Firebase console
(Identity Platform → user → Reset password) or with the Admin SDK. The
mitigating context: such a session can already read notes, files and connected
Mail credentials, so the change adds **lockout**, not new data exposure.

Deliberate choices, with reasons:

* **No `auth_time` / recent-login check.** Firebase's own `updatePassword()`
  requires a recent sign-in, which is exactly what a long-lived Kindle session
  is not. Requiring it would make the feature useless for its target user, so
  the reset goes through the Admin SDK.
* **No email, SMS or security question.** No recovery address exists; inventing
  one now would only cover future accounts.
* **No refresh-token revocation after the reset.** A blanket sign-out cannot
  tell the owner from a session thief and would just punish the owner. The
  current device stays signed in, which is what the user expects after a reset.
* **The new password is never logged or stored.** Only its length and policy
  result are inspected. Audit entries carry no secrets.

Guardrails that *are* in place:

1. Must be authenticated (`request.auth.uid`).
2. Must type the account username (case-insensitive, whitespace-trimmed). Not a
   secret — it is a deliberate speed bump against accidental/drive-by use and
   it mirrors the Delete Account confirmation.
3. Password policy: 8–128 characters, not equal to the username, not
   whitespace-only (`validateNewPassword`).
4. Per-uid rate limit: **3 per hour, 5 per day**, enforced with an RTDB
   transaction so parallel requests cannot each read the old count.
5. Audit entry under `security_events/{uid}` with `type`, server `at`,
   `authTime` and IP. Best effort: the password is already changed, so an audit
   write failure must not fail the request (the structured log is the fallback).
6. RTDB rules lock both nodes to the service account; clients can neither read
   nor write them.

## Files

| File | Role |
| :--- | :--- |
| `settings.html` | Two-mode modal, client validation, callable invocation, error mapping, i18n keys `settings.password.*` |
| `firebase-functions/password-reset.js` | Callable handler: username confirmation, rate-limit transaction, `updateUser`, audit, error mapping |
| `firebase-functions/password-reset-lib.js` | Pure policy, rate-limit maths, uid path builders (no firebase imports, testable) |
| `firebase-functions/index.js` | Exports `resetForgottenPassword` with the shared `callOptions` |
| `firebase-functions/account-deletion-lib.js` | `PRIMARY_USER_RTDB_ROOTS` includes the two new uid-keyed nodes so Delete Account clears them |
| `rtdb-rules.json` | `password_reset_limits` and `security_events` are `.read/.write: false` (service account only) |
| `scripts/test-password-reset.js` | Policy, rate-limit and handler precondition tests (`npm test`) |
| `locales/en.json` | `settings.password.*` strings (other locales fall back to English) |

## Callable contract

`resetForgottenPassword`, v2 `onCall`, primary project (`rekindle-dd1fa`).

* **Auth:** required.
* **Data:** `{ username: string, newPassword: string }`. The browser never sends
  a uid or a path.
* **Returns:** `{ success: true, changedAt: <ms> }`.
* **Error details:**

| Code | `details.code` | Meaning / client message |
| :--- | :--- | :--- |
| `unauthenticated` | — | Session gone; sign in first |
| `permission-denied` | `confirmation-mismatch` | Typed username does not match (or none could be resolved) |
| `invalid-argument` | `missing-fields` | Username or new password missing |
| `invalid-argument` | `password-too-short` / `-too-long` / `-too-guessable` / `password-rejected` | Policy rejected the new password |
| `resource-exhausted` | `rate-limited` | Includes `retryAfterSeconds` for the message |
| `not-found` | `account-missing` | Auth user no longer exists |
| `internal` | — | Generic failure; nothing sensitive is returned |

`settings.html` maps every code to a friendly, translated string; until the
function is deployed a call fails with `functions/not-found` and shows
"Password reset is temporarily unavailable."

## Data model

```
password_reset_limits/{uid} = { attempts: [epochMs, ...], updatedAt: epochMs }
security_events/{uid}/{pushId} = {
    type: 'password_reset_without_current',
    at: <server timestamp>,
    authTime: <seconds> | null,
    ip: '1.2.3.4' | null
}
```

* Attempts older than 24 hours are discarded on read; the array is capped at 10.
* The attempt is written **before** `updateUser`, so a failed Auth call still
  consumes one slot (prevents hammering).
* A same-millisecond repeat is de-duplicated so two calls in one tick cannot
  count twice.
* Both nodes are deleted by `deleteAccount` (see the inventory in
  [account-deletion.md](account-deletion.md)).

## Deploy order

1. Deploy the functions: `firebase deploy --only functions` (or the repo's
   normal deploy workflow). The callable must exist before Settings offers the
   path; until then the UI shows the "temporarily unavailable" message.
2. Deploy RTDB rules: `npm run deploy:rules:rtdb`. The nodes are already denied
   by default, so this is documentation/explicitness, but keep them in sync.

### Deploy gotcha: a gen2 callable can land without its Cloud Run invoker (2026-10-26)

The first deploy of `resetForgottenPassword` created an ACTIVE function but left
its Cloud Run service (`resetforgottenpassword`) with **no IAM bindings**. Every
browser request then failed as:

```
Origin https://rekindle.ink is not allowed by Access-Control-Allow-Origin. Status code: 401
```

That is not a CORS bug in this code: Google Frontend rejects the request before
the functions framework runs, so the 401/403 has no `Access-Control-Allow-Origin`
at all. The preflight was the tell:

```bash
# Working callable: 204 + access-control-allow-origin
curl -sS -o /dev/null -D - -X OPTIONS \
  https://us-central1-rekindle-dd1fa.cloudfunctions.net/deleteAccount \
  -H 'Origin: https://rekindle.ink' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'

# Broken callable: 403 + no CORS headers
```

`firebase-tools` normally calls `setInvokerCreate` for new HTTPS triggers
(`release/fabricator.js`: `invoker = endpoint.httpsTrigger.invoker || ["public"]`),
so this means the deploy's "set invoker" step failed or was skipped - the CLI
prints `Unable to set the invoker for the IAM policy on the following functions`
when it does. It is worth watching for that line.

Fix (idempotent, no redeploy needed):

```bash
# Cloud Run -> resetforgottenpassword -> Permissions
# add allUsers as Cloud Run Invoker (roles/run.invoker)
```

Then verify the preflight returns `204` with
`access-control-allow-origin: https://rekindle.ink`, and an unauthenticated POST
returns `401` **with** that header and the function's JSON error.

Audit other services when this happens: `cleanupsocial` is the one service that
is correctly private because it is an `onSchedule` trigger, not an HTTPS
endpoint. All callables must have `roles/run.invoker` for `allUsers`.

## Manual verification (throwaway account)

1. Sign in on a device, open Settings → Change Password → **Forgot your current
   password?**.
2. Wrong username → inline "does not match" error, nothing written.
3. New password under 8 characters / matching the username → inline error.
4. Correct username + 8+ characters → success modal. Sign out, then sign in
   with the **new** password.
5. Repeat 4 three times within an hour → "Too many attempts. Try again in N
   minute(s)."
6. Confirm `password_reset_limits/{uid}` and `security_events/{uid}` exist via
   the console, contain no password text, and that a client RTDB read is denied.
7. Delete the account and confirm both nodes are gone.

## Do not

* Re-add a current-password or recent-login requirement to the forgot path.
* Add an email/security-question recovery flow to this callable — it has no
  delivery channel.
* Log `request.data`, the password, or any derivative of it.
* Grant clients read/write access to `password_reset_limits` or
  `security_events`.
* Introduce a second rate-limit store; the transaction is the concurrency
  guard.
