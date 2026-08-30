# Security policy

## What this project is, because it decides what a vulnerability can be here

Recap Page is a static site served by a small loopback server on your own machine. There is no
hosted backend to attack, no account to take over and no database holding anyone else's data. The
app has no runtime dependencies at all, so nothing in `package.json` reaches the browser. Everything
it declares is development tooling: the four packages listed at `package.json:46-50` are the linter
and the three packages its configuration needs, and they run only on a maintainer's machine and in
CI. Your reading progress lives in one browser storage key and never leaves the machine it was made
on.

That shape rules most classic vulnerability categories out and leaves a smaller set that matters a
great deal. Anything that silently loses or corrupts the reading progress a person has spent months
building is the most serious thing that can go wrong here, and it is treated as a security issue
rather than an ordinary defect.

## What is supported

Security fixes target the current state of the default branch and the latest published release.
Older releases and tags are unsupported, and fixes are not backported to them. If you are running
an older copy, upgrade before reporting unless the problem itself prevents a safe upgrade.

Major versions mark a substantial new product generation. They are also required whenever stored
data changes in a way an older build cannot read. The rule is written in full at
`src/js/lib/version.js:5-15`. Release notes state whether saved progress remains compatible, and an
exported backup is prudent before every upgrade.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a suspected vulnerability.** A public
report is a disclosure, and it is one you cannot take back. That applies even when you are not sure
it is a real issue: report it privately and let it be assessed.

Use GitHub's private vulnerability reporting, on the repository's **Security** tab, under **Report a
vulnerability**. That route creates a private draft advisory that only you and the maintainer can
see, and it is the only channel this project accepts.

If that option is not on the Security tab, it has not been turned on. It is off by default, and on
this repository it was enabled on 2026-08-16, so it should be there. If it is not, you may be
reading this in a fork where it was never enabled. In either case, open an issue saying
only that you have a security report and asking how to send it. **Put no details in it**: not the
symptom, not the file, not the steps. That issue is a request for a channel, not a report, and one
will be arranged in reply.

Please include what you would want if you were on the other side of it: what you did, what happened,
what you expected, which browser and version, and whether any saved reading data was affected. A
minimal reproduction is worth more than a long description. If a fix is obvious to you, say so, but
do not send a pull request that reveals the issue before it is fixed.

## What to expect

This is a single-maintainer project worked on in bursts, so what follows is a target rather than a
guarantee, and saying so plainly is more use to you than a number nobody is on call to meet.

- An acknowledgement that the report has been read, aimed at within seven days.
- An assessment of whether it is in scope and how serious it is, with the reasoning, not just a
  verdict.
- A fix on the default branch for anything accepted, and a note in `CHANGELOG.md` describing it in
  the terms a person using the app would notice.
- Credit in that entry if you want it, and none if you would rather not. Ask either way.

Please hold off on public disclosure until a fix is on the default branch, or until ninety days have
passed, whichever comes first. If the report is declined you are free to publish immediately, and
the reasoning you were given is yours to quote.

## In scope

- **Loss or corruption of saved reading progress**, including anything that makes a backup, a
  restore or an undo report an outcome that is not what actually happened. This is the highest
  severity category in this project.
- **The development server**, `server.mjs`, which serves the app on the loopback origin. Path
  traversal out of the served directory, or a response that would let a page from elsewhere read
  what it serves, are both in scope.
- **The rule for which metadata API base a stored setting may name**, at
  `src/js/lib/apiBase.js:26-38`. It is not a list of permitted hosts, and deliberately not: anyone
  may point the app at their own mirror. What it does is forbid cleartext anywhere but loopback, so
  a way past that, or a way to set a base the rule should have rejected, is in scope.
- **Generated and vendored data.** Content under `src/data/`, whether written by the scripts in
  `scripts/` or kept by hand, that could execute, exfiltrate or mislead when rendered is in scope,
  as is anything in the generators that would let an upstream response do that.
- **Dependencies**, meaning the lint tooling and the GitHub Actions used by the workflow. They do
  not reach the browser, but they do run against a maintainer's checkout and in CI. How quickly an
  advisory against one of them has to be acted on is written down in `.github/dependabot.yml`, with
  the reasoning, so the threshold is something you can read rather than something you have to ask
  about.
- **The workflows** in `.github/workflows/`. The CI workflow reads the repository and nothing else,
  declared at `.github/workflows/ci.yml:18-19`, and anything that would give it more than that is in
  scope.

## Out of scope

- **Marvel's own services**, including `marvel.com`, `read.marvel.com` and the Marvel Unlimited
  reader. This app links out to them and never scrapes them. Report issues there to Marvel.
- **The third-party metadata API** the app reads from. Its availability, its correctness and its
  rate limits are not this project's to fix, and the app is written to degrade rather than break
  when it is unavailable.
- **The end of the metadata snapshot in 2025.** That is a documented boundary with a manual entry
  form as its mitigation, not a defect.
- **The fault harness** at `src/dev-faults.html`. It damages saved reading data deliberately, says
  so in the page before any button, and exists so the recovery paths can be exercised. Reporting
  that it destroys data is reporting what it is for.
- **Anything that requires an attacker to already have the reader's browser profile or their
  machine.** At that point they have the data directly, and no change here would help.
- **Missing hardening that has no reachable consequence.** A recommendation from a scanner is
  welcome as an ordinary issue; it is not a vulnerability report.

## What already reduces risk here

Recorded so a report can start from what is true rather than from what a scanner assumed.

- There are no accounts, no cloud services, no analytics and no telemetry. The app does make
  outbound requests: opening it asks a public metadata API whether it is reachable, searching for
  an issue sends what you typed to that same comics database, and adding a selected series or
  creator asks it for every issue in that run. Requests for issue details name the comic, and covers
  are fetched from Marvel's own image servers, so both receiving hosts can see which issues you are
  looking at; the reachability check names nothing. Pressing **Read** opens Marvel Unlimited when a
  direct reader link is known. Otherwise the launch tab may ask the metadata service for that link
  and falls back to the issue's page on marvel.com. Adding an issue by hand sends the words in the
  title box to the Marvel Fandom wiki, a community site Marvel does not run, and only when you press
  the lookup button; that wiki sees the title you searched for and is sent no cookie, no referrer
  and nothing about your library. An optional update check asks GitHub for the latest release
  number. Your reading progress and your notes are never sent to any of them.
- Covers are requested from Marvel's image server and from no other host. The address is reported
  by the metadata service, which is a party the reader chooses and one that could be compromised
  or hostile, so an address naming anything else is refused before a request is made rather than
  fetched and hidden. The host is written once, in `src/js/lib/coverHost.js`, and imported both by
  the normalizer that decides which cover addresses may be built and by the `img-src` directive
  the development server sends, so the rule and the policy that enforces it cannot drift apart.
- The development server sends a content security policy on every response that serves a file,
  built at `server.mjs:58-69`, alongside `nosniff`, `no-referrer` and `X-Frame-Options: DENY`, set
  at `server.mjs:143-153`. Its error responses carry none of the four, which is recorded here
  because this list is meant to be what is true rather than what was intended.
- The repository holds no secrets. Nothing in the scripts or the workflow reads a credential, and
  the metadata API needs no key.
- Dependabot alerts and Dependabot security updates are both switched on, so an advisory against
  the lint tooling or the workflow's actions arrives as a pull request rather than as silence.
  Secret scanning is on, and so is push protection, both enabled on 2026-08-16 once publication
  made them available: they are free on any public repository, and while this one was private
  GitHub answered a request to enable scanning with "Secret scanning is not available for this
  repository". Anyone can see the state without a write: asking for its alerts answers with a list
  rather than 404 "Secret scanning is disabled on this repository". Push protection depends on
  scanning and was enabled second for that reason. Asked for on its own it is accepted and then
  changes nothing, which is worth knowing before anyone reads that success as coverage.
- CI runs on every pull request with `contents: read` and nothing else.
- Every claim of the form `path:line` in every tracked file is fingerprinted against the lines it
  names, so documentation that has drifted from the code fails the build rather than misleading a
  reader.

## Windows package boundary

The x64 and ARM64 MSIX packages declare `runFullTrust` for one reason: their native Node entry
process runs a small local supervisor, which starts the unchanged server at `127.0.0.1:8787` and
opens the external default browser. The supervisor performs no network request and does not read
browser storage. It removes `MRT_PORT` and `MRT_NO_OPEN` case-insensitively before starting the
server because Windows environment names are case-insensitive.

The package adds no analytics or telemetry. Package Support Framework was evaluated and rejected
because Microsoft's NuGet binaries may collect usage telemetry when Windows diagnostic collection
is enabled. The selected supervisor is maintained JavaScript executed by the same checksum-verified
official Node runtime the package already needs.

Local package signing uses a generated self-signed certificate only for the proof machine. The
private PFX and random password are deleted after packaging. The public certificate must be trusted
with administrator approval before local install and removed by exact thumbprint after the proof.
No certificate, password, package, runtime download, or generated asset belongs in git.

Package files are read-only and hold no durable reader data. Lists, notes, settings, overrides, and
read markers remain in the browser profile at the exact loopback origin. The dedicated
[privacy policy](PRIVACY.md) owns the complete reader-facing disclosure.
