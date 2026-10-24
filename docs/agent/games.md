# Game Deep Dives

Per-game notes plus the shared game helpers. Constraints that apply to every page are in [AGENTS.md](../../AGENTS.md); read that first.

## ❓ Game Rules Helper (js/gamerules.js)

`js/gamerules.js` adds a "?" button to the title bar of games whose rules may not be universally known, opening a System 7 "How to Play" modal.

### How it works
- Pages opt in simply by including `<script src="js/gamerules.js"></script>` (in `<head>`, next to `js/i18n.js`).
- The game is detected from the page **filename** via the `ALIASES` map (e.g. `2pchess`, `livechess` → `chess`), so variants share one rules entry.
- Rules text lives in the `RULES` registry as English default HTML. At open time it calls `window.t('gamerules.<key>', defaultHtml)`, so translations can be added to locale files later without touching this script. Title/close use `gamerules.title` / `gamerules.close`.
- The modal (`#gamerules-overlay`) is appended to `<body>` (never inside `.window`) to dodge the stacking-context trap, with all CSS scoped under `#gamerules-*` selectors and explicit resets per the injected-UI rules in `AGENTS.md` (Standard UI Patterns, section 6).

### Button placement gotcha
Several games already have right-side title-bar controls (e.g. `yahtzee.html` New/Scores buttons, `chess.html` Stats, `2048.html` Reset, `spellbound.html` Stats, `oregontrail.html` Restart). The script measures those siblings with `offsetLeft`/`offsetWidth` (**pre-zoom layout units** — safe under theme.js CSS `zoom`, unlike `getBoundingClientRect()`) and shifts the "?" button left of them. All target pages' `.title-bar` rules have `position: relative`, which this relies on.

### Adding a new game
1. Add an entry to `RULES` (key) and `ALIASES` (filename → key) in `js/gamerules.js`.
2. Include the script tag in the page's `<head>`.
3. Optionally add `gamerules.<key>` translations to the locale files.

Games deliberately **excluded** (rules universally known / self-evident): tictactoe (+2p/live), snake, tetris, crossy, dino, hangman, memory, maze, jigsaw, circle, doom, mario, trivia, airtype, uno.html (menu wrapper — rules live on `liveuno.html`), life.html (life calendar, not a game).

## 🎮 Single-Player Games Catalog

The dashboard (`index.html`) reads the app registry from `icons.js`. Games are grouped by the `cat` property:

| Category | Purpose |
| :--- | :--- |
| `games` | Single-player / solitaire games |
| `two_player` | Local pass-and-play multiplayer |
| `live_game` | Firebase real-time online multiplayer |

### Single-player vs multiplayer split

Several games exist as both a single-player file and a multiplayer file. The single-player version is the canonical game name (e.g. `chess.html`), and the local/online variants add a prefix (`2pchess.html`, `livechess.html`). Following this convention keeps the catalog consistent and avoids confusing users.

### Single-player games added

*   **Tic-Tac-Toe** — `tictactoe.html` (vs CPU with Easy/Hard). Based on `2ptictactoe.html`; uses a minimax AI on Hard and random on Easy.
*   **Connect 4** — `connect4.html` (vs CPU with Easy/Hard). Based on `2pconnect4.html`; supports the same 4-in-a-row and 5-in-a-row toggle. Hard mode uses minimax with alpha-beta pruning to depth 4 plus a heuristic window evaluation.
*   **Dots & Boxes** — `dotsandboxes.html` (vs CPU with Easy/Hard). Based on `2pdotsandboxes.html`. Easy is greedy-box. Hard completes boxes, avoids giving the opponent a 3-sided box, and prefers moves that set up future boxes.
*   **Battleship** — `battleship.html` (vs CPU). Based on `2pbattleships.html`. Player places ships manually or with Auto; CPU places ships randomly and fires using hunt/target mode after a hit.
*   **Uno** — `uno.html` (solo vs bots). A wrapper that launches `liveuno.html?single=1`. The live game detects the `single=1` parameter and automatically hosts a 4-player match with 3 bots, starting immediately. The `liveuno.html` menu also has a "Play Solo vs Bots" button for the same mode.
*   **Jumpy** — `jumpy.html` (Doodle Jump-style vertical platformer). See its own section below.

All new single-player files disable CSS animations/transitions (`* { transition: none !important; animation: none !important; }`) and reuse the same System 7 window/title-bar patterns as their 2-player counterparts.

### Game mode badges and folder grouping

Games that exist in multiple modes are grouped by name in the dashboard (`index.html` → `getGroupedApps()`). The folder modal uses mode badges instead of mode names as the icon labels:

| Mode | Property | Badge |
| :--- | :--- | :--- |
| Single-player | `single: true` in `icons.js` | `1P` (`one-p-label`) |
| Local 2-player | `cat: 'two_player'` | `2P` (`two-p-label`) |
| Live online | `live: true` | `LIVE` (`live-label`) |
| New app | `new: true` in `icons.js` | `NEW` (`new-label`) |

Single-player entries that have a multiplayer counterpart (e.g. `chess`, `checkers`, `pool`, `yahtzee`, `battleship`, `connect4`, `dotsandboxes`, `tictactoe`, `uno`) should set `single: true` so the folder items are labeled with the game name and the correct badge.

**Important:** Do **not** add `single: true` to games that are single-player-only and have no multiplayer variant in the project (e.g. `crossy`, `dino`). That flag is only for the folder-grouping badge system. For solid pixel-art icons, use `filled: true` instead.

## 🟦 Cube Dash (cubedash.html)

An original cube/ship platformer inspired by Geometry Dash. It started as a port of kindle-geometrydash.netlify.app but was rewritten (2026-07) with **original branding, original level designs, and new mechanics** — do not reintroduce the reference's level strings or names. All 10 levels are original and were verified completable (with all gears reachable) by a headless bot harness.

### Mechanics (beyond the reference)
*   **Ship mode:** `w`/`q` portals switch between cube and ship. Ship physics: hold input to thrust (`SHIP_RISE -0.85` vs `SHIP_FALL 0.65`, terminal ±6.5), floor/ceiling contact is safe, any solid obstacle kills. `inputHeld` drives ship thrust AND cube auto-hop (holding = repeated jumps, like GD).
*   **Gears (`*`):** collectible, saved per-level as a bitmask in `cubedash_save_v1`. Hitbox is `x-60, w 70, top 76, h 110` — deliberately offset so a gear one char after a spike is grabbed mid jump-arc, and NOT collectable while running grounded. **If you change jump physics, re-verify gear reachability.**
*   **Obstacle grammar:** `s` spike / `d` double / `3` triple, `b` block / `h` tall block, `S` block+spike (pure kill zone), `c` ceiling spike, `P` floor pillar 88 / `U` hanging pillar 88 / `B` floating platform (top 124 — landable from a floor jump; do not move it lower), `p` pad, `r` ring, `g`/`n` gravity, `f`/`o` speed, `w`/`q` ship portals, `*` gear, `e` end gate.
*   **Physics:** 60Hz fixed timestep; gravity 1.0, jump -14, terminal 13, 80% hitbox, coyote 6 / buffer 7. Triple spikes have only a ~3-frame jump window (authentic GD tightness, do not "fix"). Portals/gates/end flag span the full corridor (`CEIL_Y 40`..`FLOOR_Y 216`) so they trigger at any altitude.
*   **Rendering is strict 1-bit — Simple Mode is FORCED ON and settings are removed** (2026-07). Like Surfer, any anti-aliased canvas pixel forces full e-ink grayscale refreshes (constant flashing), so `drawFrame()` may only use integer `fillRect` via the `fillB`/`fillW`/`rectB` helpers, Bresenham `lineB()` for diagonals, and midpoint `circleB()`/`discB()` for circles. **Banned:** `arc()`, `stroke()`/`strokeRect()`, `beginPath`/`lineTo` strokes, `ctx.rotate`/`translate` for gameplay sprites, and fractional coordinates. The cube's spin is faked with a quantized 8-direction spoke; the ship tilts via `rotPts()` + scanline `fillPolyW()` on integer-rounded points; the ring pulse steps integer radii 10–12. There is no parallax, no death particles, no settings overlay — do not reintroduce them without keeping the 1-bit rule.

### Level design & validation
Level strings live in `LEVELS` (char = 130px grid, start x 520). **Any level edit must be re-validated headlessly**: stub the DOM, `eval` the inline script, and auto-play — cube bot jumps at gap 58 (single) / 46 (double+S) / 20 (triple) / 105 (block family) measured from obstacle-left to player-right (123); ship bot holds when `y+13 > targetY` where targetY is the gap center of the nearest solid. Rules learned: gears belong exactly one char after spike-family hazards; never put floor spikes inside ship sections; after `q` (cube portal) leave ≥3 chars before the next hazard (ship-exit fall distance).

### Saves
`localStorage` `cubedash_save_v1` = `{progress[], gears[]}`. The old `gdash_*` keys, `gdash.html`, and the `cubedash_simple_v1` simple-mode key are all deleted; there is no migration (progress was trivial to re-earn). No Firebase/leaderboard — if one is added, update `firestore.rules` per the rule checklist.

## 🐸 Jumpy (jumpy.html) — Doodle Jump-Style Platformer (2026-07)

Portrait canvas (256×384 buffer, 2:3), pure B&W primitives drawn with `fillRect` (no sprite assets). Fixed 60Hz timestep with an rAF accumulator (dt clamped to 250 ms) so physics are identical on 7fps e-ink and 144Hz desktop. **`TIME_SCALE = 0.55`** scales real→simulated ms in the accumulator — this is THE e-ink pacing knob (bounce period ~1.9s, move speed ~119 px/s at 0.55; users reported 1.0 as "way too fast" on e-ink). Always tune speed via `TIME_SCALE`, never via gravity/jump velocity, so the spatial invariants below stay valid. Input: holdable ◀ ▶ buttons, arrow keys/A-D, or touch halves of the canvas (multi-source flags synced via `syncMove()`). Leaderboard `leaderboard_jumpy` (rules in `firestore.rules`); localStorage key `jumpy_highscore_v1`.

### Generator invariants (found via headless bot harness — do NOT break)
The platform generator tracks the last **bouncable** platform (`lastBouncableY/X/Type`) because breakable platforms don't bounce, and constraint checks must apply to the bouncable chain, not consecutive platforms:

1. **Vertical:** every bouncable platform ≤ 100px above the previous bouncable one (max jump height is ~166px at `GRAVITY 0.35` / `JUMP_V -10.8`). Enforced by clamping `y = lastBouncableY - 100`, NOT by converting types — converting a breakable to normal when >100px above the last bouncable does NOT help (the new platform itself ends up too far). This bug appeared twice before the clamp was added.
2. **Breakables:** only spawn ≤55px above the last bouncable platform, leaving ≥45px room for the next bouncable one. This also prevents two breakables in a row.
3. **Horizontal:** bouncable-to-bouncable center distance ≤110px. Constraining only consecutive platforms lets dx chain through breakables up to ±240px — beyond the ~173px horizontal range of a max-gap jump (verified unreachable by bot).
4. **No consecutive moving platforms** in the bouncable chain — at speed a moving pair can phase away together and become untimeable on a ~7-15fps e-ink screen. Moving speed capped at 1.2 px/step (72 px/s) for the same reason.
5. The full-width start platform never breaks, so a no-input player idles forever at score 0 — intentional, not a bug.

### Validation harness
Validated like Oregon Trail: DOM-stub + `eval` the inline script + auto-play bot that commits to a target platform on each bounce (naive per-frame targeting dithers and bounces in place on the full-width start platform — a bot flaw, not a game flaw). Assertions: no NaN, platform array stays bounded (~≤20), and **every death must have had a reachable platform at the last bounce** (`hadReachable` check) — deaths are bot skill, walls are generator bugs. 30 seeded runs passed. Note: `hadReachable` can false-positive on spring bounces (spring range ~389px vs normal 166px).

## 🏃 Surfer (surfer.html) — Subway Surfers-Style Runner (2026-07)

3-lane pseudo-3D endless runner built for e-ink: portrait canvas 256×320, fixed 10Hz timestep that **only redraws on ticks** (never per-rAF). Obstacles: barrier (jump), overhead sign (roll), train (lane-change only). Coins: low + high (jump-arc over barriers). Leaderboard: `leaderboard_surfer` (rules in `firestore.rules`); localStorage key `surfer_highscore`.

### ⚠ Canvas anti-aliasing forces full e-ink refreshes (applies to ALL canvas games)
**Any anti-aliased pixel (gray) in the canvas makes the Kindle do a full grayscale screen refresh every frame** — visible as constant flashing. Canvas AA sources: `arc()`, `stroke()`/`strokeRect()` (stroke is centered on the path → half-pixel coverage), diagonal `lineTo()`, `fillText()`, round `lineCap`, and fractional `fillRect` coordinates. Surfer's renderer is strict **1-bit**: only integer `fillRect`, Bresenham `pixelLine()` for diagonals, precomputed midpoint-circle row masks (`FILL_MASKS`/`OUTLINE_MASKS`, radii 1–12) for circles, a 3×5 `GLYPHS` pixel font for HUD text, and a static offscreen background canvas (`bgCanvas`, drawn once: skyline + track edges) blitted 1:1 per frame with `imageSmoothingEnabled = false`. Quantizing scaled geometry to integers causes minor 1px stepping as objects grow — acceptable, grays are not. Reuse this pattern for any new animated canvas game.

### Tuning invariants (found via headless bot harness — do NOT change blindly)
*   **`JUMP_DUR` (0.6s) must be SHORTER than the minimum spawn gap** (`speed * 0.55` in `spawnRow`). With 0.85s jumps, consecutive barrier rows forced land-into-death with no re-jump window — the bot died every run. Same reason `ROLL_DUR` is 0.9s (must outlast the approach + tick quantization at max speed 15).
*   **`JUMP_SAFE = 0.3` is the 1-tick reaction floor.** At 10Hz, a jump started one tick before impact gives `jumpFrac() = sin(π·0.1/0.6) ≈ 0.36`. Any threshold above ~0.35 kills players who jumped on the last valid tick. Grounded = frac 0, so barriers still kill non-jumpers.
*   **`COLLIDE_Z = 0.5`** resolves hits at the visual contact plane. 1.2 resolved ~25px before the obstacle visually reached the player ("I wasn't touching it" deaths); resolution is a monotonic `z <= COLLIDE_Z` crossing check, so there is no tunneling even at dz=1.5/tick.
*   **Spawn fairness rules in `spawnRow()`:** never 3 trains in one row (at least one lane is always jumpable/rollable/open); triple rows (train+barrier+sign) only at speed ≥ 9.5; no obstacles at all for the first 50 units. Inputs mutate `player.lane` instantly (no per-tick queue), so double-tap lane escapes are legal — don't add an input queue.
*   **Speed ramp:** `6 + min(9, distance/120)` → cap 15 at ~1080 distance. Gap formula keeps obstacle *time* spacing (~0.55–0.8s) constant at all speeds.

### Validation harness
Validated like Oregon Trail: DOM-stub + `eval` + auto-play bot (perfect play survived 25×180s with 0 deaths; idle player dies at ~17s; ~135 coins/run collected). **Any change to jump/roll physics, `COLLIDE_Z`, spawn gaps, or speed ramp must re-run a survival bot** — fairness regressions are invisible to eyeball testing. Harness pattern: capture rAF manually, step 100ms frames, bot dodges/jumps/rolls from a state export.

## 🐂 Oregon Trail (oregontrail.html) — Rebuilt 2026-10

A faithful, readable trail sim built for a 600x800 e-ink viewport. Rebuilt from scratch (2026-10) after the 2026-07 version: the old one clipped its action bar on short viewports, flashed the screen while hunting (anti-aliased canvas strokes), and could strand a run at The Dalles. Save key is `rekindle_oregontrail_save_v3` (v2 saves are ignored, not migrated); high score is `oregontrail_highscore_v1`.

### Screen flow
`setup` (profession, 5 names, departure month) → `store` → `trail` ⇄ `fort` (full screen) and overlays for the hunt and the generic modal. The trail screen is a fixed column: scene, HUD (3 rows + Pace/Rations toggles), progress track, party chips, journal (the only flexible row) and a 2x2 action bar. **Keep the flexible row the journal** — the window is `height: 90vh; min-height: 0` and `body { overflow: hidden }`, so anything that cannot shrink gets clipped on a rotated Kindle.

### Day engine (`advanceDay`)
One call per day, in this order: date → weather → travel miles (blizzard may halt) → food → pace damage → rest heal → climate → conditions → oxen exhaustion → random event → landmarks → merge the death queue → winter check → end check → save → render → `processQ()`.

* **Two queues.** `Q` is the per-day modal queue; `DQ` holds deaths as they happen. `advanceDay` starts with `Q = DQ.slice(0)` and ends with `Q = Q.concat(DQ)`, so a death that occurred *outside* the day (river, Dalles) is still shown, and a death during the day is shown after the day's event. Never push a death straight into `Q` — the next `advanceDay` would wipe it.
* **Modal system.** One generic `#modal` whose buttons are built per item (`showModal({title,text,extra,buttons})`). `processQ()` opens at most one item (`if (modalOpen) return`) and calls `afterQueue()` only when the queue is empty. `afterQueue()` re-opens a pending river/Dalles and chains the Barlow Road days; it is guarded by `roadPending` so a double `processQ()` cannot schedule the road twice.
* **The Dalles** is a *flag* (`G.dalles`), not a one-shot modal: `takeAction` refuses to travel while it is set and `afterQueue` re-opens it after a reload. Both choices end in `roadStep()` days and a normal `checkEnd()` win.
* **Forts** are screens, not modals. `G.nextLm` still points at the fort until `leaveFort()` increments it — that is also how `resume()` knows to re-open the fort store.

### Balance invariants (found by simulation — change with a harness run, not by guessing)
* **Rest is not a free reset.** Resting heals `+6` (`+2` while sick) and cures at `restCure`; filling rations only heal `+1` and only for healthy members. Earlier values (8/+2) made the party unkillable: 100% wins with 4.9 survivors.
* **Contagion** — each member carrying cholera/dysentery/typhoid/measles gives a 5%/day chance to infect one healthy member. This is what produces mid-trail wipes; removing it flattens the difficulty curve.
* **Cold needs two sets per person.** `clothing >= 2*alive` → 1 dmg, `>= alive` → 2, else 4; a blizzard adds +2 even when dressed.
* **The passes close.** `WINTER_DAY = 366` (Dec 31) ends the run if `miles < 2000`; `WINTER_WARN = 305` (Nov 1) posts a warning modal. Without the deadline, late departures simply crawl through the snow for 240 days and still win, and resting has no cost.
* **Pace** `13 + oxen*1.8` base miles/day, `×[1, 1.2, 1.45]` pace, `×[1..0.3]` weather, `×0.7–1` terrain, `×[0.55..1]` ox fatigue, `×0.85..1` party condition. A March start finishes in ~165 days; June in ~180 with far more blizzard days.
* Rations consume `[1.5, 1.0, 0.6]` lbs/person/day. Starving damages `5/`day and blocks rest healing; a stranded party (no oxen) gets 4 days of grace before `Game Over`.
* Repair without parts keeps the pity timer (`repairFails`, 25% → 100% over 4 attempts) so `wagonBroken + 0 parts` cannot softlock. A party with 0 oxen can always buy one from the Trade offer (`{cash:40} → 1 ox`).

### Hunting minigame (1-bit, no flashing)
Canvas scene, `setInterval` at **600 ms** (not rAF). The renderer is strict 1-bit: integer `fillRect` only — a 2 px ground bar, a 1 px stepped ridge skyline, grass/pines/animals built from rects, and hit/miss marks as rect crosses. **No `stroke()`, `fillText()`, `arc()` or fractional coordinates** — one anti-aliased pixel forces a full grayscale refresh on the Kindle every tick (see the Surfer note above). All text lives in DOM (`#hunt-status`, footer hint).

Sizing: on open, set `canvas.width/height` from `clientWidth/clientHeight` after the overlay is shown, and derive every spawn/draw coordinate from `hunt.W/hunt.H`. The page includes the standard zoom-exemption CSS block so `getBoundingClientRect()` matches touch coordinates. Shots consume `G.bullets`; the day advances on `endHunt()`.

### i18n
Short UI strings are translated in all 10 locales; narrative strings (events, landmark descriptions, game-over text) live in `en.json` plus in-code fallbacks. Dynamic interpolated text goes through `tpl()` (manual `${var}` replace) — `window.t(key, vars)` does **not** interpolate. The page's helper is named `translate()`, never `t()`, to avoid shadowing `window.t`. New UI elements must have their English default in the HTML *and* an `en.json` entry; a missing locale key just leaves the HTML text.

### Leaderboard (server-written)
Collection `leaderboard_oregontrail`, registered in `firebase-functions/score-config.js` (`max 50000, rate 25, base 5000, dir higher`) with a read/owner-delete rules block. The page includes `js/score-submit.js` (`data-game="oregontrail"`) and calls `RekindleScores.submit('leaderboard_oregontrail', { score })` on a win — **never** a client `db…set()`. Deploy functions before rules.

### Headless validation harness
`node scripts/test-oregontrail.js [runs] [seed]` — DOM/localStorage/timer stubs, `vm.runInThisContext` of the inline script, then a reasonable-player bot (rests when hurt or tired, hunts at two weeks of food, buys at forts and leaves them). Env switches: `OT_CASUAL=1`, `OT_RECKLESS=1`, `OT_MONTH=6`, `OT_PROF=farmer`, `OT_EDGE=1`.

`OT_EDGE=1` checks the paths the bot skips: stranded ox purchase, river wait → ferry, save/resume, resume at a fort, restart, win scoring, and the 4-day stranded game over. **Run `OT_EDGE=1` after touching modals, resume or the end-game code.**

Reference numbers (2026-10, 200 seeded runs): 82% wins, ~171 days, 4.8 survivors, score 4.3k average / 6.4k max; reckless play (travel only, never rest or hunt) wins ~15%; every loss is either the winter deadline or a disease cascade. If a change moves these numbers a lot, it changed the game's difficulty.

## 📓 Flipbook (flipbook.html) — Frame Corruption & Performance Fixes (2026-07)

A user report ("multiple clicks to open, drastic lag, flipbooks merge together, frames double") traced to four bugs, all now fixed:

1. **Doubled frames (re-entrancy):** `openAnimation()` had no loading feedback and no guard, so impatient extra taps re-entered it. Interleaved async decode loops each did `frames = []` then pushed into the shared global → 2N frames, persisted by autosave. Fix: `isOpening` guard, a `showLoadingModal()`/`hideLoadingModal()` overlay, and decoding into **local arrays** via `Promise.all(data.frames.map(decodeFrame))`, swapping the globals atomically only after all frames decode.
2. **Merged flipbooks (async ID race):** old `performSave()` read the global `currentAnimationId` *after* `await`ing thumbnail generation, so switching animations mid-save wrote A's frames under B's ID; a pending 1s autosave timer could also fire after `openAnimation` had assigned the new ID. Fix: `performSave()` is now fully synchronous up to the fire-and-forget Firestore write, captures `animId` up front, and `openAnimation()` clears the autosave timer + flushes `performSave()` for the old animation *before* assigning the new ID (`currentAnimationId = id` now happens only after a successful load).
3. **Lag (autosave re-encoding):** every autosave (1s after each stroke) re-encoded **every** frame to a 256×256 PNG data URL. Fix: `frameUrlCache[]` parallel to `frames[]` holds encoded PNGs; `saveCurrentFrame()` marks the edited index dirty (`null`), `getAllFrameUrls()` re-encodes only dirty frames, and `openAnimation()` seeds the cache from the stored base64 (an open-then-repost now encodes nothing). `createThumbnail()` is synchronous and reuses module-level scratch canvases.
4. **Lag (per-pointermove allocation):** `renderCanvas()` allocated a new 256×256 canvas on every pointermove for onion skin. Fix: one reusable `onionCanvas`, only re-`putImageData` when `currentFrameIndex` changes (`onionLoadedIndex`).

Also: `requirePro()` gates create/open — if the Firestore subscription check hasn't resolved yet (`subChecked === false`) it shows "Verifying subscription..." instead of flashing the paywall, which was part of the "multiple clicks" complaint. `localStorage.setItem` of animation data is wrapped in try/catch (64MB cache limit). When touching frame add/delete/save logic, keep `frameUrlCache` spliced/pushed in sync with `frames`.

### Fill bucket & undo/redo (2026-07, both pixel.html and flipbook.html)

*   **Flipbook `floodFill` must match on ALPHA ONLY** (`data[idx+3] < 240`), not on color+alpha tolerance vs the tapped pixel. Strokes are opaque black on a transparent buffer with anti-aliased (partial-alpha) edges; color/tolerance matching stops at the AA fringe and leaves visible "gap" pixels between the fill and the stroke. Alpha-threshold matching lets the fill flow under the AA edge. The fill sets alpha 255, so filled cells never re-match (no infinite loop).
*   **Pixel `floodFill` must compare grid values with a tolerance (0.05)**, not exact float equality. The shade slider is continuous, so regions that look uniform on e-ink can differ by 0.01–0.02 and silently block an exact-match fill. Guard `if (Math.abs(targetValue - newValue) <= tolerance) return;` — this also prevents filled cells (now > tolerance from target) from re-matching forever.
*   **Flipbook undo/redo** uses action descriptors in `undoStack`/`redoStack` (`MAX_HISTORY = 10`, each ≤ one 256×256 ImageData ≈ 256 KB): `{type:'edit', index, image}` (stroke/fill/clear — snapshot via `bufferCtx.getImageData` BEFORE mutating), `{type:'insert', index}` (add/duplicate frame), `{type:'delete', index, image}`. `resetHistory()` is called in `createNew()` and `openAnimation()`. Stroke snapshots are pushed in `startDrawing`; fill snapshots only when `floodFill` returns true (it no-ops on solid-stroke taps). After any undo/redo, reset `onionLoadedIndex = -1` and mark `frameUrlCache[index] = null` (dirty). `saveCurrentFrame()` is called at the top of `undo()`/`redo()`/`deleteFrame()` so snapshots reflect pending buffer state.

## Fitting a square game canvas + controls vertically (`crossy.html`)
A canvas styled only with `width: 100%; max-width: 512px` scales with **width** only, so on short screens the canvas + on-screen controls overflow the `95vh` window — and with `body { overflow: hidden; touch-action: none; }` the window cannot be scrolled to reach the controls.

**Pattern:** Size the canvas in JS from the actual leftover vertical space, measuring the other chrome via the DOM so title-bar zoom/padding are accounted for:

```javascript
function resizeCanvas() {
    if (!canvas) return;
    var win = document.querySelector('.window');
    var content = document.querySelector('.window-content');
    var maxW = Math.min(content.clientWidth - 30, 512); // content box width, capped
    var maxWindowH = Math.floor(window.innerHeight * 0.95); // matches .window max-height
    var othersH = win.offsetHeight - canvas.offsetHeight;   // everything except the canvas
    var size = Math.floor(Math.min(maxW, maxWindowH - othersH - 8)); // -8 = canvas border
    if (size < 128) size = 128;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
}
```

Call it in init, on `resize`/`orientationchange`/`load`, and with a couple of delayed `setTimeout`s (theme.js may apply title-bar zoom after first paint, changing available height).

---

## 🏆 Leaderboard Integrity (added 2026-10-20, after the "IMAOKASDF IS HACKING" report)

**Symptom:** a user set `6.7e+67` on Pac-Man and "infinity" on several other games, and appeared first everywhere. The old design let the browser write its own score and `firestore.rules` only checked `score is number`:

```javascript
// OLD — still what every pre-2026-10 build tries to do
db.collection('leaderboard_surfer').doc(uid).set({ username, score: 1e308, timestamp: … });
```

One line in the devtools console was enough. **Do not reintroduce a client write to `leaderboard_*`.** There is no client-side check that a cheater cannot skip.

### How it works now

| Piece | File | Job |
| :--- | :--- | :--- |
| Score policy | `firebase-functions/score-config.js` | Per-collection `min`/`max`/`dir`/`rate`/`base`; the only place to tune limits |
| Server writes | `firebase-functions/scores.js` | `startGameRun` + `submitScore` callables; the only writer of leaderboard docs |
| Rules | `firestore.rules` | `leaderboard_*`: `read` for signed-in users, `delete` for the owner, **create/update denied** |
| Client helper | `js/score-submit.js` | Starts a run on page load, submits on game over; never throws into the game |
| Cleanup | `admin/reset_cheated_scores.js` | Dry-run by default; `--apply` deletes entries outside the configured bounds |

Flow:

1. Game page includes `<script src="js/score-submit.js" data-game="surfer"></script>` (after the Firebase compat scripts). On auth it calls `startGameRun`, which writes `game_runs/{uid}_{game}` with a **server** `startedAt`.
2. When the game ends, `window.RekindleScores.submit('leaderboard_surfer', { score: n })` calls `submitScore`.
3. The server accepts a new best only if
   `max(prev, base) + rate × secondsSinceRunStart <= n <= absMax` — `base` replaces `prev` only for a brand-new entry, it does **not** stack on every run (otherwise reloading would farm it) — then writes `username` (looked up from RTDB `users_public`), `timestamp` (server) and `verified: true`.

So a fabricated value is capped by *how long the game was actually open*, and a hard per-game maximum. Rejected attempts are logged to `score_audit` (admin-only) for review.

### Adding / changing a leaderboard

1. Add the collection to `firebase-functions/score-config.js` with sensible bounds (`max` near the best human score, `rate` ≈ 10× a good player's points/sec).
2. Add a matching block to `firestore.rules` with read + owner delete only (see the existing ones).
3. Include `js/score-submit.js` with the right `data-game`, and replace any direct write with `RekindleScores.submit(collection, payload)`.
4. Deploy **functions first, rules second** — deploying the rules alone makes every score submission fail silently.

Notes:

- `dir: 'lower'` (moves, time) has no time allowance: you cannot grind your way to fewer moves, so only `min`/`max` apply.
- `float: true` is only for trivia's cumulative percentage; everything else must be a whole number.
- `opaque` fields (`stats`, `daily`, `unlimited`) sync wordle/spellbound state; they are size-capped but never used for ranking.
- The pet board uses `base = max` because age grows with real time, not with play.
- Run documents are per `(uid, game)` and are replaced on every page load, so a stale "started last year" token cannot be kept around.
- Deleting a leaderboard document is allowed for its owner (reset); re-creating it still goes through the server, so it cannot be used to launder a score.

### Purging the scores that were already written

```bash
cd admin
node reset_cheated_scores.js            # dry run: list every impossible entry
node reset_cheated_scores.js --apply    # delete them
```

It flags non-numeric, non-finite, fractional-integer, and out-of-range values against `score-config.js`. Deleting removes that player's whole entry for the board — they re-earn a real score.

### Calibration lessons from the 2026-10 incident

The live data is the only reliable source of bounds — check it before tightening anything:

- The client SDK happily stored `Infinity` as a Firestore double, and one user stored the **string** `"∞²"` in `leaderboard_dino_v1`. Any numeric validation must therefore reject non-finite values and non-numbers, not just "too big".
- Real pet ages were **100-439**, not 0-100. A guessed cap of 100 would have deleted dozens of legitimate entries; the board now allows up to 100,000 (it grows with real time, not play).
- Mario `time` is **fractional** (`42.356599999998274`), so that field needs `float: true`. Most other boards are whole integers and are validated as such.
- `totalPercent` on trivia is a **sum of per-game fractions**, so it must be allowed to grow by <1 per game and must stay a float.
- The dry run is the safety net: run `node admin/reset_cheated_scores.js` and read the offender list before ever using `--apply`. `--apply` writes a JSON backup to `admin/backups/` (gitignored) first.

The 2026-10 run removed exactly 12 entries (Infinity / `6.77e+67` / `"∞²"`) across snake, pacman, dino, pet, mario and surfer; a second dry run reported 0 offenders.

### Residual risk (be honest about this)

These games run entirely in the browser, so the server can bound a score but cannot verify that it was *played*. A determined user can still open a page, wait, and submit a value the time allowance permits. What is gone is the "one line, infinite score, first place" attack; anything remaining costs real time and leaves an audit trail.

## 🚗 Car Games (cargames.html, 2026-10-20)

Ten pass-the-device party games in one page, built to match the road-trip pack on
KindleHub: Car Cricket, Alphabet Hunt, Categories, Keep It Going, Plate Words,
Rhyme Time, Same Page, Spot Bingo, Story Chain, Would You Rather.

### Why one page, not ten
The Kindle is handed around in a car, so switching games must not cost a page load
(this browser reloads the whole document per navigation). `cargames.html` keeps a
hub view and a game view and toggles panels in place; all ten live in one document.

### Shared crew
`localStorage.rekindle_car_crew` holds 2-8 player names (default `Player 1`,
`Player 2`). Every turn-based game reads it, so names are entered once on the hub
instead of per game.

### Per-game state
Each game persists under `localStorage.rekindle_car_<gameid>` (`cricket`,
`alphabet`, `categories`, `keepgoing`, `plate`, `rhyme`, `samepage`, `bingo`,
`story`, `wyr`). Normalisers (`normCricket`, `normBingo`, ...) coerce a restored
blob back into a valid shape so a corrupted or older blob cannot throw at boot.
`showHub()` and `showGame()` both call `plateStop()` / `storyStop()`: the
60-second intervals would otherwise keep ticking (and writing state) while a
different game is open.

### Deliberate non-features
- No Firebase, no leaderboards, no network. These are offline car games; the
  server-timed `submitScore` flow (leaderboard section above) does not apply and
  must not be bolted on without a run-token design.
- No canvas: everything is DOM buttons/text, so it stays touch-accurate under
  `theme.js` CSS zoom (the canvas coordinate bug in `AGENTS.md` §6).
- No animation for the Same Page countdown: Ready → 3 → 2 → 1 → prompt are four
  explicit taps, not a timer, so a slow e-ink refresh cannot desync the players.

### Visual redesign — "ReKindle editorial" hub (2026-10-20)

The 2026-10 first version read as a wall of heavy boxes: a grey crew panel with
full-width inputs at the top, ten identical tiles with 2px borders + 2px shadows,
tiny 0.6-0.7rem blurbs, a large grey how-to block and four boxed stat cells per
game. It fit the System 7 *chrome* but not the ReKindle *page* language (see
`weather.html`/`reader.html`/`index.html`: hairline rules, one strong window,
uppercase letterspaced micro-labels, Georgia prose, generous white space).

What changed (all inside `cargames.html`; **no new i18n keys**, every label
reuses the existing `cargames.*` keys):

- **Hub order is games-first**: `Pick a game` is the first block (large `sec-title lg`
  with a `01–10` meta), then the ten numbered tiles, then `CREW`. Crew is a
  two-column grid of 48px fields with a wash-coloured number cell; Add/Remove are
  compact 1px secondary buttons. With two players everything fits a 600×800
  window without scrolling.
- **Tiles are a printed catalogue, not cards**: 1px border, no shadow, 76px min
  height, a small grey `01`-`10` index in the corner, bold name + Georgia blurb.
  The old 42px monogram boxes (42/AZ/ABC…) are gone; the number is the identity.
- **Game view**: compact 48px `‹ ALL GAMES` button, a `game-head` with a 2.2rem
  grey catalogue watermark (`#game-index`, set in `showGame`), and a light
  left-ruled how-to (3px rule, Georgia 0.8rem) instead of the grey box.
- **Scoreboard strip**: `.stat-row` is a single band with 2px top/bottom rules and
  1px vertical dividers; no per-stat boxes or shadows.
- **Button hierarchy**: `.btn.primary` (black) for the forward action, `.btn.ghost`
  (1px, no shadow) for tertiary actions, default white for the rest. Action rows
  use `.btn-row` / `.two` / `.three` CSS **grids** (flex `gap` is banned on
  Chromium 75); the old `.row` flex wrapper is gone.
- **Compact game window**: `showGame()` adds `.window.compact-view` and `showHub()`
  removes it — `height:auto; max-height:90vh` with the content child
  `flex:0 1 auto; min-height:0`, so Rhyme/Same Page no longer leave half a page of
  white below the buttons. Long panels (Bingo) still fill 90vh and scroll.
- **Small touches**: Alphabet gets a bordered `.meter` fill (`#alpha-meter`, set in
  `renderAlphabet`), Crew numbers are zero-padded (`01`), and the back button is a
  full 48px touch target. `showHub()` focuses the last-played tile with
  `focus({preventScroll:true})` so returning from the bottom of the catalogue does
  not jump the hub away from its heading. `renderCricketLog()` strips a trailing
  `+N` from the translated button label before appending the score (the en label
  is already "Car +1", which used to render as "Car +1 +1").

Verification: rendered with WebKit at 400×700, 600×800 and 800×1000 (scale 1) and
driven headlessly — every tile opens, Back returns, cricket add/undo/out, alphabet
meter, bingo marks, plate word, Same Page four-tap reveal and WYR tally all pass
with 0 JS errors; `npm test` (compat + i18n) passes. Only `en.json` carries the 128
`cargames.*` keys, so other locales fall back to the HTML English (pre-existing).

### Testing without a browser
`jsdom` (installed in a temp dir, not the repo), `runScripts:'dangerously'`, then
drive it: click every tile, assert each panel opens and Back returns, then per game
(cricket run/out/reset, alphabet count, plate rejects out-of-order letters, bingo
marks, Same Page four-tap reveal, Would You Rather tallies). All 10 initialise with
0 JS errors. The page also passes the static checker: no `?.`/`??`, no flex `gap`,
no emoji, no `alert`, no `aspect-ratio`/`min()`/`max()`.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).

## 2026-10-20: host migration + idle loops (audit `docs/audit-2026-10-20.md`)

- **Six live games stopped deleting their game node on host disconnect.** `livechess`,
  `livecheckers`, `liveconnect4`, `livedotsandboxes`, `livetictactoe` and `liveyahtzee` each had
  `matchRef.onDisconnect().remove()` (where `matchRef` is `games/<type>/<id>`), so a host network
  blip wiped the match for everyone. Those calls are gone, and each `listenToMatch()` now carries
  the liveuno migration block:
  ```js
  if (gameState.players && gameState.host && !gameState.players[gameState.host]) { /* promote oldest human */ }
  isHost = !!(currentUser && gameState.host === currentUser.uid);
  ```
  Re-deriving `isHost` on every snapshot is the important half: without it the promoted client
  keeps `isHost === false` and never runs the host-only timers.
- **`livepictionary.html`** had the same missing `isHost` re-derivation (it already kept the game
  node). Fixed in `listenToMatch()`; the promoted host's round timers now run.
- **`pacman.html`** stops its `requestAnimationFrame` loop in `endGame()` and while idle (start
  modal up), re-arming in `startGame()`.
- **`cubedash.html`** skips `drawFrame()` while paused or level-complete.

When adding another live game, copy `listenToMatch()` from `liveuno.html` (migration + `isHost`
line) rather than the older scaffold - the drift is what produced the six bugs above.

## Cookie Clicker (cookieclicker.html) — 2026-10-24

**Hidden from the home screen (2026-10-24):** the APPS entry in `icons.js` is
commented out, so the icon, search result, Recent tile and folder entry all
disappear while `/cookieclicker` remains playable and documented in Help.
Uncomment the block in `icons.js` and bump `icons.js?v=` to restore it.

The first single-player idle game. Two modes in one page, switched by the
`Cookies` / `Stimulation` tabs (or `?mode=stimulation`):

- **Cookies** — classic tap + buildings + upgrades, one tick per second for
  e-ink. Buildings: 8, costs scale at `1.15^owned`. Upgrades: 11, unlocked by
  clicks, building counts, golden cookies and total baked. A golden cookie
  appears on a 60–180 s timer and pays ~10% of the bank. Local save
  (`rekindle_cookie_v1`) plus `users/{uid}/settings/cookieSave`; offline
  production is capped at 8 h at 50%. No leaderboard: idle saves are editable
  offline, so a server-validated score would be meaningless.
- **Stimulation** — a short, run-based parody of Neal.fun's *Stimulation
  Clicker* (original names/visuals, no audio/video). Click for stimulation,
  then activate 10 stimuli (DVD logo, podcast, autoplay, algorithm, …). Active
  stimuli generate points; the "chaos" is a capped text feed refreshed every
  7 s, not animation. Activate all 10 → "You reached the beach" ending. Run
  state is in-memory only and resets on reload; best run is
  `rekindle_stimulation_best`. Boosts cost 3× the activation cost and double
  that stimulus for the rest of the run.

**E-ink rules:** no canvas, no `requestAnimationFrame`, no CSS animation; the
cookie tick redraws numbers once per second and only rebuilds the shop on a
purchase/unlock. The stimulation feed caps at 8 lines and is only appended
while that tab is open (`stimMode`), so the cookie tab does not keep churning
DOM.

**Saves are separate:** stimulation never writes to the cookie save, and the
cookie save never touches the stimulation run. `theme.js` handles scaling
normally because there are no touch-coordinate games on this page.

## Neal.fun-inspired candidates (2026-10-24)

*Stimulation Clicker* is now the **Stimulation** tab in `cookieclicker.html`:
an original, silent, text-feed adaptation (no audio/video/animation), played as
a ~10-minute run with an ocean ending. The source game is [Neal.fun's Stimulation
Clicker](https://neal.fun/stimulation-clicker/); its loop is documented on
[Wikipedia](https://en.wikipedia.org/wiki/Stimulation_Clicker) (click for points,
buy upgrades that generate points, all upgrades unlock a beach ending, no saves).

Other Neal.fun games were assessed for ReKindle feasibility:

| Game | Fit | Effort | Notes |
| :--- | :--- | :--- | :--- |
| Spend Bill Gates' Money | High | 2–4 h | Pure catalogue + cart math, no backend; a natural Tools app. |
| Absurd Trolley Problems | High | 2–3 h | Text dilemmas + choices; content authoring is the main cost. |
| The Password Game | Medium | 1–2 days | Rules engine is intricate; high retention but needs careful validation. |
| Color Match / Higher Lower | High | 2–3 h | Tiny single-player games; low content cost. |
| The Deep Sea / Space Elevator | Medium | 1 day | Scroll-to-scale data; text/ASCII works on e-ink, canvas does not. |
| Design the Universe | Medium | 1 day | Simple controls, but brand-new UI patterns. |
| Internet Artifacts | Low | 1–2 days | Image-heavy; Kindle cache and slow decode work against it. |
| Infinite Craft | Low | Multi-day | Needs an LLM/combination backend and cost control; also already requested. |
| Draw a Perfect Circle | Done | — | `circle.html` already covers it. |
| Stimulation Clicker | Done | — | Stimulation tab in `cookieclicker.html`. |

Rule of thumb: copy the *interaction idea*, never the assets, audio, exact copy or
branding. Credit Neal Agarwal in Help. e-ink pages should translate motion into
text/state changes (as Stimulation mode does) rather than hiding animations
behind `animation: none`.
