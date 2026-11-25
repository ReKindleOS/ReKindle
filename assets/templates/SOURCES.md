# Pixel tracing template sources

All templates are **original ReKindle pixel art**. They are hand-authored as
16x16 `#` / `.` grids in [`scripts/pixel-template-art.js`](../../scripts/pixel-template-art.js)
and contain no third-party artwork, so no external attribution is required.

- `LICENSE.txt` — CC0 1.0 dedication for the template art.
- `../../scripts/pixel-template-art.js` — source of truth for the shapes.
- `../../js/pixel-templates.js` — generated runtime data (committed).

Regenerate the runtime data with:

```sh
node scripts/build-pixel-templates.js
```

`node scripts/test-pixel-templates.js` renders the same source in memory and
fails if the committed `js/pixel-templates.js` drifts from the art.
