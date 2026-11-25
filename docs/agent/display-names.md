# Display names vs the login handle (2026-11-26)

ReKindle accounts have **two** names, and they are deliberately separate:

| Name | Where it lives | Case | Used for |
| :--- | :--- | :--- | :--- |
| **Handle** (username) | The Firebase Auth email local part: `email.split('@')[0]` | always **lowercase** | signing in, `@mentions`, DM/profile lookups, moderation checks (`username === 'ukiyo'`, supporter lists), recovery and account-deletion confirmation |
| **Display name** | `user_cards/{uid}/displayName`, `users_public/{uid}/displayName`, Auth `displayName` | **preserved exactly** | the dashboard greeting, settings "Logged in as", KindleChat author/DM/gallery names, Neighbourhood posts and profiles |

## Why the handle can't carry capitals

Registration creates `username@rekindle.ink` in Firebase Auth. Firebase **lowercases email addresses** (lookups are case-insensitive: `getUserByEmail('Ukiyo@rekindle.ink')` returns `ukiyo@rekindle.ink`). Every page that derived the name from the email therefore printed `ukiyo`, and changing the Auth email cannot change that.

So put capitals in the **display name** only. Never build lookups, keys or role checks from it.

## Registration (server)

`registerUser` in `firebase-functions/index.js` creates the account and the profile nodes with the typed username:

```js
await admin.auth().createUser({ email, password, displayName: username });
// users_public and user_cards:
{ username: username, displayName: username, ... }
```

`user_cards.username` is the identity; `user_cards.displayName` is what the UI prints. `rtdb-rules.json` / `rtdb-social-rules.json` validate `displayName` as 1–40 characters of letters, digits, dot, dash or underscore and block the reserved impersonation words (`ukiyo`, `rekindle`, `admin`, `mod`, `support`, …), with the owner exempt.

## Rendering rule

```js
var shown = cardShownName(card);   // print this: card.displayName only when it
                                   // is a capitalisation variant of card.username
var handle = card.username;        // lookups, role checks
```

Every render path applies the same guard: a stored `displayName` is printed **only** when it is a capitalisation variant of that account's handle. Anything else — an old free-form nickname or a forged value written directly to RTDB — falls back to the username. This keeps legacy `users_public.displayName` values from resurfacing now that the display name is preferred. The guards are duplicated in `js/home.js`, `settings.html`, `index_old.html`, `kindlechat.html` (`cardShownName`) and `neighbourhood.html`; `scripts/test-display-names.js` runs the checks against real inputs.

Implemented in:

- `js/home.js` and `index_old.html` — the greeting prefers Auth `user.displayName` (only when non-empty, <20 chars and not email-like), falling back to the email handle. `rekindle_last_username` still stores the handle so the sign-out prompt can prefill the login form; opening the login window drops it again (see the last section).
- `settings.html` — "Logged in as" prints the display name (handle in the tooltip); the password-reset and delete-account confirmation forms still use the handle.
- `kindlechat.html` — `resolveMessageAuthor`, DM names, gallery/pixel-art authors and reply prefixes use `displayName || username`; `currentUsername`, message `user` fields, reactions and avatar caches stay on the handle. The old hard-coded `Ukiyo` in the DEV branch is gone.
- `neighbourhood.html` — `getKindleName()` and post/comment headers prefer the display name; the Edit Profile form owns the Display Name input; profile saves no longer rebuild `user_cards.username` from the lowercase email (that silently flattened capitals on every save). A profile save/social-profile load also syncs Auth `displayName` into `users_public`.

Auth `displayName` can be stale in an existing browser tab: the SDK caches the user record. The dashboard therefore paints from `localStorage` (`rekindle_display_name:<uid>`, written from the last valid card/Auth name) and re-reads `user_cards/{uid}/displayName` once per tab session, so the greeting does not flash the lowercase handle and a case change made elsewhere is picked up. A Neighbourhood save writes the new value to that cache and clears the session refresh flag. The edit form also reloads Auth after a save; an admin-side change shows after a token refresh or the next sign-in. Card/`users_public` names are read fresh (5-minute cache).

## Changing a display name

Neighbourhood → Profile → **Edit Profile → Display Name** (added 2026-11-26). The field is prefilled with the current display name and accepts **only a case-only change**: same length, and every changed character is an ASCII letter case swap (non-letters, including the `+` some OAuth emails use, must match exactly). Saving calls the `setDisplayName` callable (`firebase-functions/index.js`), which re-checks the rule against the Auth email and writes Auth `displayName`, primary `user_cards.displayName`, and both `users_public.displayName` nodes (only when the node already exists). Any letter change, added/removed character or different username is rejected before the profile writes. There is no home-screen modal and no Settings editor.

The owner account was backfilled with the Admin SDK, which remains useful for support:

```js
await admin.auth().updateUser(uid, { displayName: 'Ukiyo' });
await admin.database().ref('user_cards/' + uid + '/displayName').set('Ukiyo');
// social project:
await socialApp.database().ref('users_public/' + uid + '/displayName').set('Ukiyo');
```

The owner account was migrated on 2026-11-26: `displayName: "Ukiyo"` on Auth, primary `user_cards` and social `users_public`; the login handle remains `ukiyo` / `ukiyo@rekindle.ink`. `scripts/test-display-names.js` (in `npm test`) pins the split: registration writes both names, display sites prefer `displayName`, role checks and lookups stay on `username`, profile saves no longer rebuild the handle, and both rule sets validate `displayName`.

## Not covered (still handle-based)

- Topic documents store `authorName` at creation from the handle, so they still show `ukiyo`.
- Game leaderboard names come from `email.split('@')[0]` on the server (`firebase-functions/scores.js`), so they remain lowercase.
- `fetchProfileByUsername()` and DM search match `user_cards.username` exactly (case-sensitive by design).

## Login / Register clears the previous account's cached identity (2026-11-26)

**Symptom:** on a device that had been signed in, opening Login / Register on the home
screen still showed the previous person: the menu bar kept its cached name and avatar, and
the "Signed out — your session ended unexpectedly" prompt prefills `#username` from
`rekindle_last_username`, so the next person's "fresh" form already contained the last
handle. A typed password (or a previous `Error: ...` message) could survive too, because
closing a modal only hides it.

**Fix:** `openLogin()` in `js/home.js` calls `resetLoginWindow()` *before* showing
`#login-modal`:

- `clearCachedIdentity()` removes `rekindle_last_username`, sweeps every
  `rekindle_display_name:<uid>` and `rekindle_home_avatar:<uid>` key (one small entry per
  account this device has seen), and for the recorded `rekindle_uid` drops
  `rekindle_ucard_<uid>` through `rekindleInvalidateUserCard()` plus the
  `rekindle_display_name_refreshed:<uid>` session flag.
- `rekindle_ucard_*` is **not** swept wholesale: that cache also holds other members'
  cards, so a full sweep would re-download every author on the next KindleChat load.
- The menu bar is repainted as the guest bar (`home.guest_mode` + `drawGuestAvatar()`) so
  the old name/avatar cannot sit behind the modal.
- `#username` / `#password` are blanked and `#login-msg` is restored to its first-run copy
  (`loginMsgDefault`, captured on the first open; the element has no `data-i18n` key).

**Guards:**

- The clear runs only while `!currentUser`: a live account's cache is not stale data, and
  its avatar is not re-downloaded for nothing.
- The one path where a signed-in user can see the guest bar for a moment is
  `index?login=true` during auth restore; the auth listener repaints and `onSignedIn()`
  closes the modal.
- `rekindle_uid` is deliberately kept (`handleGuestMode`): it is the "this device was
  signed in" hint that keeps a slow Kindle auth restore booting. Only `confirmLogout()`
  removes it.
- Cost: a cleared avatar cache is one `user_cards/{uid}` read on the next signed-in load
  (`watchUserCard` re-fetches and re-caches it). No Firebase operations are added while
  signed out.
- **Lite / Legacy (`index_old.html`)** has no cached identity (its greeting is painted from
  Auth only, and it draws no avatar), so `openLogin()` there only blanks `#username` /
  `#password` and restores `#login-msg`. Same shared-device rule, no cache to sweep.

**Shipped as** `js/home.js?v=25` in `index.html` and `sw.js` `ASSETS_TO_CACHE`.
`scripts/test-home-avatar-cache.js` pins the ordering, the key list, the live-session
guard and the matching `?v=` in both files.
