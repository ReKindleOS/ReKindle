# Adding a ReKindle language

ReKindle's UI strings live in `locales/<language>.json` (the app) and
`locales/privacy-<language>.json` (the privacy policy). `locales/en.json` is the
source of truth for keys; English never fetches its own file.

## The files

| File | Used by |
| :--- | :--- |
| `locales/<code>.json` | Every page, through `data-i18n` / `window.t()` |
| `locales/privacy-<code>.json` | `privacy.html` only (`data-i18n-file="privacy"`); optional |

Use an ISO 639-1 code (`nl`, `sv`, `ja`). Regional variants resolve to the base
code (`pt-BR` → `pt`), so one file covers the language. The one exception is
Traditional Chinese: `zh-TW` / `zh-HK` / `zh-MO` map to the real `zh-Hant`
locale (`locales/zh-Hant.json`), not to `zh`.

Privacy files are **optional** for a UI-first language, but the 2026-11-10 batch
includes machine-generated `privacy-<code>.json` files with a visible
machine-translation notice. Only the English policy is human-written; it is the
authoritative version. Add `--privacy` to the generator, and have a speaker
review the legal wording when possible.

## Translation rules

1. **Never rename or translate a key.** Translate the value only.
2. **Keep `${...}` placeholders exactly.** `window.tFormat()` fills them in; a
   dropped or renamed placeholder loses data. `node scripts/test-locales.js`
   fails on a mismatch (this caught `de`'s `ao3.error.load_feed`).
3. **Keep the meaning of `data-i18n-html` strings.** Only those may contain
   simple markup (`<b>`, `<br>`, links that already exist in English). Never add
   `<script>` or event handlers.
4. **Missing keys are allowed.** The English text in the page markup is the
   per-key fallback, so a partially translated language still works. The test
   prints how many keys are missing.
5. **Use the native name** for the language picker (`Nederlands`, not `Dutch`);
   the English name is only for metadata/tooling.
6. **Right-to-left** (`ar`, `he`, `fa`, `ur`) needs `"dir": "rtl"` in
   `js/i18n.js` and a visual pass; the loader sets `<html dir="rtl">`.
7. **No web fonts.** Kindle browsers only render installed system fonts.
   Check CJK/Indic/Thai/Arabic glyphs on a real device before shipping.

## Checklist

1. Copy `locales/en.json` to `locales/<code>.json`, then translate values.
2. Optional: copy `locales/privacy-en.json` to `locales/privacy-<code>.json` and
   translate it — the generator's `--privacy` mode does this with a visible
   notice; a speaker should still review legal wording.
3. In `js/i18n.js`:
   * add `{ code: '<code>', name: '<English name>', native: '<native name>', dir: 'ltr' }`
     to `LANGUAGES`;
   * add `<code>` to `SHIPPED`;
   * add country mappings to `COUNTRY_LANGUAGE` if Auto should pick this
     language on a Kindle (Kindles often report `en-US`).
4. Latin-script languages only: see the detector steps in
   `docs/agent/i18n.md` (`npm run build:lang`, bump `DETECT_URL`).
5. Run `node scripts/test-locales.js` and `node scripts/test-i18n.js`.
6. Bump `js/i18n.js?v=` on every page, then rebuild and deploy.

The Settings dropdown is generated from `shippedLanguages()`, so no HTML edit is
needed. `?lang=<code>` previews a locale before it is added to `SHIPPED`.

## Bulk machine translation (development only)

`scripts/translate-locales.js` fills a new language from `locales/en.json`:

```bash
node scripts/translate-locales.js nl sv tr --force
npm run translate:locales -- nl sv tr
```

It uses Bing's translator by default (`--google` switches to gtx), batches at
most 10 strings per request (Bing starts leaving UI text in English above that),
protects `${...}` / `{{...}}`, validates placeholder + HTML tag/href parity, and
writes the file only after every batch succeeds. `--repair` retries values that
stayed English; `--individual` sends one string per request. It is a development tool: never call it from the app or `npm test`.
Output is **unreviewed machine translation** behind the BETA language badge.

The 2026-11-10 batch (40 languages total) was generated this way; privacy
policies were deliberately left in English. See
[`docs/agent/i18n.md`](../docs/agent/i18n.md#machine-generated-locale-batch-2026-11-10)
for the list, rationale and detector caveats.
