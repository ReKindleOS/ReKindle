# Akinator relay service

Always-on Node 22 process that hosts the Chrome-TLS Akinator relay used by
`akinator.html`. It has **no Firebase/GCP dependency** and no database: the
Akinator `session` token is the whole game state, so each HTTP request maps to
one Akinator request.

Why a relay is required: Akinator's Cloudflare fingerprints the TLS ClientHello
(JA3/JA4), so plain `fetch`/`curl`/Cloudflare Workers get the 403 challenge page.
`got-scraping` presents a Chrome TLS/HTTP2 fingerprint and gets the real game
page. Browsers cannot call Akinator directly because it sends no CORS headers.

## Local development

```bash
cd akinator-service
npm ci
PORT=8080 npm start
```

Then, in another shell:

```bash
curl -sS -X POST http://127.0.0.1:8080/ \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8788' \
  --data '{"action":"start","region":"en"}'
```

Offline unit tests (parsers, CORS, validation, rate limit):

```bash
node ../scripts/test-akinator.js
```

## Deploy: Northflank Developer Sandbox (free, always-on)

Northflank's free **Developer Sandbox** gives you two always-on services
(typically 0.2 shared vCPU / 512 MB each), no request metering and no sleeping.
Northflank may ask for a card for identity verification; the free plan
blocks/limits overages instead of billing you. If the console only offers
`nf-compute-10` (0.1 vCPU / 256 MB), that is still enough for this I/O-bound
relay — just watch memory in the service metrics.

Prerequisite: this directory must be pushed to the GitHub repository Northflank
builds from.

```bash
git add akinator-service scripts/test-akinator.js akinator.html build-automation.js .gitignore package.json
git commit -m "Add standalone Akinator relay service and drop dead CORS proxies"
git push
```

Then:

1. Sign up at <https://app.northflank.com/signup> (GitHub), choose the
   **Developer Sandbox** plan and add the verification card.
2. Create a project (e.g. `rekindle`) in **US East** (or UK).
3. Create a **Service**:
   * Repository: the ReKindle repository.
   * Build type: **Dockerfile**.
   * Build context: `akinator-service` (must be the service directory, **not**
     the repo root — the Dockerfile's COPY paths are relative to it).
   * Dockerfile path: `/akinator-service/Dockerfile`.
   * Port: **8080** (HTTP).
   * Health check path: `/healthz`.
   * Compute plan: **nf-compute-20** (0.2 vCPU / 512 MB) — free on Sandbox.
4. Deploy and copy the public service URL.
5. Verify it against the real upstream:

   ```bash
   ./smoke.sh https://your-service-url
   ```

   A `200` with `session`/`question` means Northflank egress is accepted by
   Akinator. If it returns `upstream_blocked`, stop — the same image runs on any
   Node host (`node server.js`), so move it to Render / Hugging Face Spaces /
   Oracle Always Free instead and use that URL.

6. Set `BACKEND_URL` in `akinator.html` to the service URL (trailing slash is
   fine), then rebuild/deploy the site.

## Cutover checklist

1. Change `BACKEND_URL` in `akinator.html` to the Northflank URL.
2. `npm test && npm run build`.
3. `npm run deploy:beta`, play a full game on `beta.rekindle.ink/akinator`
   (start, several answers, guess, continue).
4. `npm run deploy:prod`, repeat on `rekindle.ink`.
5. Keep the Firebase `akinator` function deployed for ~48h as a rollback. Then
   delete it (`firebase functions:delete akinator --project rekindle-dd1fa
   --region us-central1 --force`), remove the export from
   `firebase-functions/index.js` and `got-scraping` from its `package.json`,
   and update `docs/agent/integrations.md`.

## Behaviour

* `POST /` (or `/akinator`) with JSON `{action: start|answer|back|continue}` —
   same contract as the old Firebase function.
* `OPTIONS` is answered with the CORS allowlist and `Access-Control-Max-Age`.
* `GET /healthz` returns `{ok:true}` without calling Akinator.
* Per-IP token bucket (120 burst, 2 req/s refill) as a cheap abuse guard.
* Upstream requests time out after 9 s; the client allows 20–25 s.
