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


## Deliberately blank avatars (2026-11-24)

Board report `-P62sF8F9YAtFOe7MLlz`: a user with a blank profile picture could not keep it —
`drawAvatar()` treats an all-zero `customAvatar` as malformed and falls back to a generated
uid pattern, so "blank" was unrepresentable.

* The sentinel is the string **`'blank'`** stored in `customAvatar` (RTDB `user_cards` and
  social `users_public`). Every `drawAvatar()` copy returns after painting the white canvas,
  before the array/hash branches (`neighbourhood.html`, `kindlechat.html`, `topics.html`,
  `index.html`, and the eight live-game pages).
* `neighbourhood.html` profile editor has a **Blank** button (`useBlankAvatar()`); saving an
  empty 16x16 canvas from the Draw Icon editor stores `'blank'` too (`hasInk` check).
  Regenerate/Clear still restore the generated avatar (they set `customAvatar = null`).
* All-zero **arrays** keep the old fallback behaviour: they are still treated as broken data
  (the 2026-11-06 blank-avatar report), so only the explicit sentinel renders blank.
