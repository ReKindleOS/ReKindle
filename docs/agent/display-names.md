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
var shown = card.displayName || card.username;   // print this
var handle = card.username;                      // lookups, role checks
```

Implemented in:

- `js/home.js` and `index_old.html` — the greeting prefers Auth `user.displayName` (only when non-empty, <20 chars and not email-like), falling back to the email handle. `rekindle_last_username` still stores the handle so the login form can rebuild the email.
- `settings.html` — "Logged in as" prints the display name (handle in the tooltip); the password-reset and delete-account confirmation forms still use the handle.
- `kindlechat.html` — `resolveMessageAuthor`, DM names, gallery/pixel-art authors and reply prefixes use `displayName || username`; `currentUsername`, message `user` fields, reactions and avatar caches stay on the handle. The old hard-coded `Ukiyo` in the DEV branch is gone.
- `neighbourhood.html` — `getKindleName()` and post/comment headers prefer the display name; the Edit Profile form owns the Display Name input; profile saves no longer rebuild `user_cards.username` from the lowercase email (that silently flattened capitals on every save). A profile save/social-profile load also syncs Auth `displayName` into `users_public`.

Auth `displayName` can be stale in an existing browser tab: the SDK caches the user record. The edit form reloads it after a save (so the new case shows immediately); a name changed by an admin shows after a token refresh or the next sign-in. Card/`users_public` names are read fresh (5-minute cache).

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
