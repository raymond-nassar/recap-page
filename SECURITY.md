# Security policy

<a id="what-this-project-is-because-it-decides-what-a-vulnerability-can-be-here"></a>

## About the app

Recap Page keeps reading data on your device. Desktop uses a loopback server and browser storage;
Android has separate private app storage. There is no hosted backend, account, or shared user
database.

The app has no runtime dependencies. Its development dependencies are lint tooling: the four
packages listed at `package.json:54-58` run on a maintainer's machine or in CI, not in the browser.

Silent loss or corruption of saved reading progress is the highest-severity security issue here.

## What is supported

Security fixes target the current state of the default branch and the latest published release.
Older releases and tags are unsupported; fixes are not backported. Upgrade before reporting unless
the problem prevents a safe upgrade.

Major versions mark a new product generation or a saved-data change older builds cannot read;
see `src/js/lib/version.js:5-15`. Check release notes for compatibility and export a backup before
upgrading.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a suspected vulnerability.**
Report privately even if you are unsure; public disclosure cannot be taken back.

Use **Security > Report a vulnerability** on GitHub. This creates a private draft advisory visible
only to you and the maintainer. It is the project's accepted reporting channel.

Private reporting was enabled here on 2026-08-16, but may be unavailable in a fork. If the option
is missing, open an issue asking how to send a private report. **Put no details in it**: no symptom,
file, or reproduction steps. That issue requests a reporting channel, not disclosure of the problem.

In the private report, include what you did, what happened, what you expected, your browser and
version, and whether saved reading data was affected. Provide a minimal reproduction and any
suggested fix. Do not submit a public pull request that reveals the issue before it is fixed.

## What to expect

This is a single-maintainer project. These are targets, not guaranteed response times:

- Acknowledgement within seven days.
- An assessment of scope and severity, with reasons.
- A fix on the default branch for accepted reports and a reader-facing note in `CHANGELOG.md`.
- Credit if you want it. Let the maintainer know your preference.

Wait to disclose until a fix reaches the default branch or ninety days pass, whichever comes first.
If the report is declined, you may publish immediately and quote the reasoning.

## In scope

- **Lost or corrupted reading progress**, including a backup, restore, or undo that reports the
  wrong result. This is the highest-severity category.
- **The development server**, `server.mjs`: path traversal outside its served directory or
  responses that let another origin read its content.
- **Metadata API base validation**, at `src/js/lib/apiBase.js:26-38`. Readers may use their own
  mirrors, so hosts are not allowlisted. Cleartext is allowed only on loopback. Bypassing that
  rule or accepting an invalid base is in scope.
- **Generated and vendored data.** Content under `src/data/`, whether written by the scripts in
  `scripts/` or kept by hand, that could execute, exfiltrate or mislead when rendered is in scope,
  as is anything in the generators that would let an upstream response do that.
- **Development dependencies and GitHub Actions.** They run against a maintainer's checkout and in
  CI, not in the browser. `.github/dependabot.yml` defines advisory response thresholds.
- **The workflows** in `.github/workflows/`. CI uses read-only repository permissions,
  declared at `.github/workflows/ci.yml:33-34`. The optional manual Android rehearsal also reads
  repository Actions run metadata to verify its origin, declared at
  `.github/workflows/ci.yml:248-250`. Neither grants write or Play publication access. Changes
  that expand these permissions are in scope.

## Out of scope

- **Marvel's own services**, including `marvel.com`, `read.marvel.com` and the Marvel Unlimited
  reader. This app links out to them and never scrapes them. Report issues there to Marvel.
- **The third-party metadata API**, including its availability, correctness, and rate limits.
  The app should keep working when metadata is unavailable.
- **The end of the metadata snapshot in 2025.** That is a documented boundary with a manual entry
  form as its mitigation, not a defect.
- **Expected damage from the fault harness** at `src/dev-faults.html`. It warns before the buttons
  that it deliberately damages saved data to exercise recovery.
- **Attacks requiring access to the reader's browser profile or machine.** That already gives
  direct access to the saved data.
- **Missing hardening that has no reachable consequence.** A recommendation from a scanner is
  welcome as an ordinary issue; it is not a vulnerability report.

## What already reduces risk here

Consider these safeguards when preparing a report:

- There are no accounts or hosted reading-data services, and no analytics, tracking, or telemetry. On startup, the app
  asks the comics database whether it is reachable. Issue searches send the words you type; browsing
  a selected series or creator requests the comics it lists. Details requests name the comic,
  and covers load from Marvel's own image servers. Those services see which issues you request;
  the reachability check names none. Pressing **Read** opens Marvel Unlimited when a reader link
  is known. Otherwise the launch tab asks the metadata service for that link and falls back to the
  issue page on marvel.com. The hand-entry lookup sends your title to the Marvel Fandom wiki only
  when you press the lookup button, with no cookie, referrer, or library data. The Android prototype
  also sends the digital issue ID to Marvel's Bifrost service for an app link. That request sends
  no credentials or referrer, bypasses caching, and saves no response. Marvel sees the digital ID
  and network address. Saved progress and notes are never sent by these service requests.
  The app has no software update check or download; Microsoft Store delivers Store package updates.
- Covers are requested only from Marvel's image host. A metadata service could return a hostile
  URL, so other hosts are rejected before any request. `src/js/lib/coverHost.js` supplies the
  allowed host to both normalization and the server's `img-src` policy.
- The development server sends its content security policy on every application-generated
  response, built at `server.mjs:64-75`, alongside the three companion headers assembled at
  `server.mjs:79-84`. The server contract checks all seven application statuses at
  `test/server-contract.test.js:274-315`. Responses rejected by Node's HTTP parser before the
  request handler runs are outside that guarantee.
- Keep secrets out of the repository. The default metadata API needs no key.
- Dependabot alerts and security updates are enabled. Secret scanning and push protection were
  enabled on 2026-08-16 after publication. Push protection depends on scanning: enabling it alone
  can report success without providing coverage.
- CI runs on every pull request with `contents: read` and nothing else.
- Every `path:line` claim in tracked files is fingerprinted against its cited content.
  Drift fails the build.

## Windows package boundary

The x64 and ARM64 MSIX packages use `runFullTrust` to run a Node coordinator that starts the server
at `127.0.0.1:8787` and opens the default browser. The coordinator requests only the local cache-proof
health endpoint, makes no external requests, and does not read browser storage. It removes
`MRT_PORT` and `MRT_NO_OPEN` case-insensitively before starting the server, matching Windows
environment-name rules.

The server runs independently of the launch console, with separate standard streams. Reuse requires
the Recap Page server identity, the exact package-input digest, and a listener whose executable and
server command both belong to the current package. Older or foreign listeners are rejected.
Package update and removal terminate the background process. If they fail, proof cleanup terminates
only the recorded process IDs.

The package adds no analytics or telemetry. Package Support Framework was rejected because its
Microsoft NuGet binaries may collect telemetry when Windows diagnostics are enabled. The JavaScript
coordinator uses the package's existing checksum-verified official Node runtime.

Local proof signing uses a self-signed certificate for that machine only. Delete its private PFX
and random password after packaging. Trust the public certificate with administrator approval before
installing, then remove it by exact thumbprint after the proof. Keep certificates, passwords,
packages, runtime downloads, and generated proof assets out of git.

Package files are read-only and hold no saved reading data. Lists, notes, settings, overrides, and
read markers stay in the browser profile at the exact loopback origin.
The [privacy policy](PRIVACY.md) gives the full disclosure.

## Public project home and question form

The GitHub Pages project home is an information site, not the app. It publishes only approved HTML,
CSS, and showcase images. It has no script, form, iframe, service worker, manifest, tracker module,
analytics, or telemetry, and cannot read browser state at `127.0.0.1:8787`.

The Pages workflow uploads the reviewed artifact. Only its deployment job has `pages: write` and
`id-token: write`. It uses no secret and never publishes a pull request head. The artifact,
allowlist, workflow, and hosting boundary are in scope for this policy.

The public question form asks about maintained documentation and receives only what a visitor
types. The tracker never calls it. **Do not put suspected vulnerability details in the project home,
a public issue, a discussion or a pull request.** Report privately as described above.

GitHub handles Pages requests and public Issues. See the [privacy policy](PRIVACY.md) for details
and the limits of removing content after publication.
