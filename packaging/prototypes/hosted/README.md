# Hosted static prototype

This is an isolated feasibility prototype. It does not change the default local app, the Pages workflow, root package files, or any production launcher. It does not deploy files or select a hosting provider.

The build derives an allowlisted copy from `src` into an empty directory outside the repository. Generated copies are disposable and must not be committed. The manifest records the source commit, input and output paths, byte lengths, SHA-256 hashes, content digest, and each adaptation. The content digest covers every output file except the manifest that contains the digest.

```powershell
node packaging\prototypes\hosted\build.mjs --out=C:\Users\<you>\AppData\Local\Temp\recap-hosted-root --base-path=/
node packaging\prototypes\hosted\check.mjs --out=C:\Users\<you>\AppData\Local\Temp\recap-hosted-root --base-path=/
node packaging\prototypes\hosted\browser.mjs --out=C:\Users\<you>\AppData\Local\Temp\recap-hosted-root --base-path=/

node packaging\prototypes\hosted\build.mjs --out=C:\Users\<you>\AppData\Local\Temp\recap-hosted-nested --base-path=/prototype/
node packaging\prototypes\hosted\check.mjs --out=C:\Users\<you>\AppData\Local\Temp\recap-hosted-nested --base-path=/prototype/
node packaging\prototypes\hosted\browser.mjs --out=C:\Users\<you>\AppData\Local\Temp\recap-hosted-nested --base-path=/prototype/
```

The output path must be empty and outside the repository. Build options are explicit so the root and nested deployments have separate, reproducible artifact identities. The browser runner requires installed Edge and `puppeteer-core` outside this repository. Set `MRT_PUPPETEER` and `MRT_EDGE` when they are not at the repository's documented defaults. Each run uses a fresh temporary browser profile, a 1280 by 900 viewport, an ephemeral loopback port, synthetic external metadata responses, and covers disabled. It blocks real external requests.

## Adaptations and limitations

The generated manifest uses the selected base path for the web app manifest and reader launch. The hosted capability module reports local-server health as not applicable, makes no health request, and replaces local-server recovery wording with a static-host limitation. The local health control is disabled. Exact source-shape checks make the build fail if these adaptations no longer match their expected inputs.

The local harness serves the artifact with the proposed response contract below. It is evidence for the artifact path, MIME, and response-header behavior only. It does not establish behavior on a real HTTPS host, provider-specific configuration, metadata CORS, or browser behavior for a hosted origin.

| Header | Contract |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://i.annihil.us data:; font-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `Cache-Control` | `no-cache` |

`frame-ancestors` is a response-header requirement. A meta CSP cannot replace it. Static hosts must also serve the documented MIME types, apply the headers to every app response, and route the selected base path to `index.html`. These are host requirements, not claims that a chosen provider can satisfy them.

The composed browser journey exercises the bundled House of M list, read/defer/rating writes, same-origin reader launcher, a refused synthetic metadata lookup, separate reading/history/draft exports, invalid and cancelled restores, reload, and a prepared offline reload. It checks that same-origin resources stay under the selected base path and that Cache API entries stay same-origin. Storage remains in the browser profile. External metadata is stubbed and is not uploaded; cover requests are disabled.

## HTTPS decision

Live HTTPS and metadata CORS evidence is blocked. No owner-approved exact host, destination, or upload scope is available. Do not upload the artifact or request a public URL from this prototype. The browser and loopback harness cannot substitute for real TLS, observed response headers, or a noncredentialed CORS request from an approved HTTPS origin. Treat production hosting as blocked pending that approval and a separate owner decision.
