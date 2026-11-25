# Avatars (Grayscale & ReKindle+ Gate)

How `customAvatar` float arrays render and where the gradient gate lives. Read before changing avatar drawing, `user_cards`, or the pixel-art picker.

## 🖼 Grayscale Avatars (`customAvatar` float arrays) & ReKindle+ Gradient Gate

`customAvatar` arrays (stored in RTDB `user_cards/{uid}` and social `users_public/{uid}`) support **float shade values 0..1**, not just 0/1 — 0 = white, 1 = black, mid values = gray (matching `pixel.html` grid values). Gradient pixel-art avatars are a **ReKindle+ feature**.

*   **Gate (neighbourhood.html only):** the pixel-art avatar picker locks any 16x16 drawing whose grid has any value strictly `> 0 && < 1` (`gridHasGradients()`). Non-plus users see the item greyed out (`.pixel-picker-item.locked`, opacity 0.5 + `filter: grayscale(1)`) with a `.pixel-picker-lock-badge` ("PLUS", reuses `neighbourhood.lbl.plus`); clicking it shows `showGradientPaywallAlert()` instead of selecting. `selectPixelArtAsAvatar()` re-checks server-side-of-client (data + `isPlus`) as a guard. `isPlus` comes from `localStorage.rekindle_is_pro`.
*   **Four `drawAvatar()` copies render grayscale:** `neighbourhood.html`, `kindlechat.html`, `topics.html`, `index.html` all have their own `drawAvatar(canvasId, seed)`; each renders array values `0 < v < 1` as `rgb(s,s,s)` where `s = Math.round((1 - v) * 255)`, then restores `fillStyle = '#000'`. **If you add a new page that draws avatars from `user_cards`, copy the grayscale-aware loop, not the old `seed[i] === 1` check.**
*   `gridToAvatar()` (neighbourhood.html) clamps grid values to 0..1 instead of binarizing; pure B&W art (already 0/1) is unaffected.
*   The 1-bit "Draw Icon" editor (`openAvatarModal()`) **binarizes on load** (`v >= 0.5 ? 1 : 0`) so a gradient avatar is WYSIWYG in the editor; saving from that editor replaces the avatar with 1-bit data.
*   Grayscale avatars are static one-time canvas draws, so they do NOT cause the e-ink full-refresh flashing that animated anti-aliased canvases do (contrast with the Surfer/Cube Dash 1-bit rules).

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).


## Pure white avatars & deleted profiles (2026-11-25)

White is a legitimate avatar choice, so a blank white canvas can never mean "this account is
gone". Deleted profiles use a person outline instead.

* The canonical white avatar is the string **`'blank'`** in `customAvatar` (RTDB `user_cards`
  and social `users_public`). Every `drawAvatar()` copy returns after painting the white
  canvas, before the array/hash branches (`neighbourhood.html`, `kindlechat.html`,
  `topics.html`, `index.html`/`js/home.js`, and the eight live-game pages).
* A **complete all-zero 8x8/16x16 grid** is white too — not broken data. The pixel-art
  picker returns zeros for an all-white drawing (`gridToAvatar()`), and clients before
  2026-11-24 saved an erased Draw Icon canvas that way. In `neighbourhood.html`,
  `kindlechat.html` and `topics.html` the array branch therefore **always returns** after a
  valid 8/16 grid; it must not fall back to the uid pattern. That fallback (added for the
  2026-11-06 "i cant see pfps" report) is why pure white pfps silently turned into a
  generated pattern.
* **Malformed** data still falls back to the pattern: a non-array `customAvatar` (e.g. `{}`),
  or an array whose length is not 64/256. `avatarSeed` is unchanged.
* `neighbourhood.html` has a **Blank** button (`useBlankAvatar()`); saving an empty 16x16
  canvas from the Draw Icon editor stores `'blank'` too (`hasInk` check). Regenerate/Clear
  still restore the generated avatar (they set `customAvatar = null`).
* **Deleted profiles** (no `user_cards`/`users_public` record) are drawn by
  `window.rekindleDrawDeletedAvatar()` from `js/deleted-user.js`: the **guest16.png**
  portrait (a 16x16 outlined frame around a person) in black on white. The same art is the
  dashboard guest badge (`drawGuestAvatar()` in `js/home.js`, which index loads separately),
  so the two copies are marked KEEP IN SYNC and `scripts/test-avatars.js` renders both and
  compares them. Callers pass the canvas (or id); it scales to any square canvas and draws
  one `fillRect` per horizontal ink run (37 rects, not 66).
  `drawAvatar(canvas, null)` stays the *loading* state (white) — do not overload `null`.
  Covered call sites: KindleChat message/DM/gallery/pixel-art avatars, Topics message
  avatars, Neighbourhood post avatars. Live-game pages do not render deleted profiles
  distinctly (they fall back to the uid pattern).
* Trade-off: an all-zero grid from genuinely broken data now renders white instead of a
  pattern. That is intentional — it is the only way users can keep a pure white pfp, and the
  guest portrait disambiguates deletion.
* `scripts/test-avatars.js` (in `npm test`) extracts the three `drawAvatar()` copies and pins
  these rules against a recording canvas: `'blank'`/all-zero are one white fill, a single ink
  pixel still renders, malformed data falls back to the pattern, and the guest portrait
  matches **guest16.png** pixel-for-pixel at 16px and matches `js/home.js` at 16/32/48/128px.
  Update it when the avatar render path or the guest art changes.
