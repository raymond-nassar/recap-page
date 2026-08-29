# Microsoft Store package and certification proof

This document owns the current Windows MSIX packaging and Microsoft Store delivery status for
Recap Page. It describes local package evidence, not a published Store release.

## Current status

The repository builds signed x64 and ARM64 version `2.0.0.0` packages and one x64/ARM64 bundle. A
separate x64 version `2.0.0.1` remains outside the Store output for the earlier update proof.

Structural inspection on Windows 11 ARM64 proved:

- Both package manifests use the exact production identity and Store-safe version `2.0.0.0`.
- The bundle contains exactly one x64 package and one ARM64 package at that version.
- Each package contains one executable payload: its architecture-matched official Node runtime.
- The package entry process and its server child reported x64 for the x64 package and ARM64 for the
  ARM64 package.
- The packaged x64 and ARM64 Node executables match Node's published SHA-256 values.
- The proof-only x64 version `2.0.0.1` is outside `dist/msix/` and absent from the bundle.

The built candidate hashes are:

| Artifact | SHA-256 |
|---|---|
| x64 MSIX | `4B07E7A8987201DD04329156F2B0AD390CAFFF3C73790D2B8524A65CEF69CF6F` |
| ARM64 MSIX | `5EB43A7FEB0D04030079BA6C5FF02B1A59645F3366433D378AD22C11EA0CE0DF` |
| x64/ARM64 bundle | `E1E60C46CECE9BDAA165701DFB4686AE2F7DAC3E3A6421CCE6BBC9BED52B66FA` |

These hashes name the post-review build that removes every casing of the two origin-changing
environment names. Its generated certificate has thumbprint
`ECD962B70BC9A556651CE7F06E04BBB70ED65F22`. It was temporarily trusted for one bounded proof, and
the corrected artifacts passed all four aimed installed scenarios:

- The x64 package started at the canonical origin with complete ready guidance.
- The x64 package refused an occupied port with complete safe guidance, no browser-window change,
  and a witnessed server-child exit.
- Installing the final bundle on Windows 11 ARM64 selected its ARM64 slice and started at the
  canonical origin with complete ready guidance.
- The ARM64 slice refused an occupied port with complete safe guidance, no browser-window change,
  and a witnessed server-child exit.

The earlier candidate was installed with only certificate thumbprint
`E36EBC5FA20DA01A8D73E30B7C6EB25FAFAD188E` temporarily trusted in LocalMachine
TrustedPeople. All five installed scenarios passed:

- The x64 package started at the production AUMID, served `proof-2.0.0.0` at the canonical origin,
  and retained both ready-guidance lines.
- The x64 package refused an occupied port, retained all safe guidance, exited its server child, and
  left the browser-window digest unchanged.
- The x64 proof-only update changed the served generation from `proof-2.0.0.0` to
  `proof-2.0.0.1`.
- Installing the final bundle on Windows 11 ARM64 selected its ARM64 slice, started native ARM64
  supervisor and server processes, served `proof-2.0.0.0`, and retained ready guidance.
- The ARM64 slice selected from the final bundle refused an occupied port, retained every safe
  guidance line, exited its server child, and left the browser-window digest unchanged.

The earlier update journey did not repeat because package version flow and browser behavior did not
change. It remains evidence for version selection and state continuity rather than for the corrected
launcher bytes.

After each installed proof, the exact certificate was removed. CurrentUser Root and LocalMachine
Root returned to 49 certificates with digest
`CBEABFC3A4AED45E67ECB54F4FE73E74CEE39F4C95A9849C883CCDA6C9A6543D`.
CurrentUser TrustedPeople and LocalMachine TrustedPeople returned to one certificate with digest
`6BA56A5FAA86B42F5D081EFC34FCA3D22748B3C57AB0912D90D6784BD029B3FD`.
Neither the current nor earlier proof thumbprint remains in those stores.

The earlier signed x64 package installed on Windows 11 ARM64 under x64 emulation and proved:

- Start activation launched the earlier x64 package entry point.
- The package starts its bundled x64 Node runtime and the unchanged local server.
- The server binds and opens exactly <http://127.0.0.1:8787/>.
- Existing reading state remains visible in the same Edge Personal profile.
- A read marker survives package stop and an installed package generation change.
- An occupied port leaves the existing safe guidance visible and opens no alternate origin.
- The original browser state can be restored with every field equal; only the backup export
  timestamp changes between exports.

One explicitly approved UAC prompt for that earlier proof temporarily added only its public certificate to
LocalMachine TrustedPeople. Versions `2.0.0.0` and `2.0.0.1` installed and the three bounded package
scenarios passed. The package, listeners, launcher processes, private backups, and that exact
thumbprint were removed afterwards; the TrustedPeople store returned to its baseline digest.

Those installed scenarios recorded:

- `start-profile-reader-relaunch`: production AUMID activation started the 5,632-byte launcher and
  its x64 Node child, served `proof-2.0.0.0`, displayed the exact ready guidance, and opened the
  current Edge Personal profile with its 1-of-1 read sentinel.
- `busy-port-refusal`: the package Node child exited, the launcher retained the complete existing
  safe guidance, and the browser-window digest did not change.
- `update-state-continuity`: the installed generation changed from `proof-2.0.0.0` to
  `proof-2.0.0.1` at the same origin while the same-profile sentinel remained 1 of 1 read.

The browser backup was restored afterwards. Excluding the regenerated `exportedAt` timestamp, the
pre-proof and restored JSON both had SHA-256
`723fb65b670b9eff25253b4c82e472272465e07d5983e499dccbc03a27135343`.

The TrustedPeople baseline contained one certificate with digest
`6BA56A5FAA86B42F5D081EFC34FCA3D22748B3C57AB0912D90D6784BD029B3FD`.
During the proof it contained that baseline plus only thumbprint
`50B43BE6C1ED610A7E86E7786E589A0AB5581494`. After cleanup the count and digest matched the baseline.

Before owner authorization, importing the same public CER to CurrentUser TrustedPeople succeeded,
but `Add-AppxPackage` failed with `0x800B0109` / `CERT_E_UNTRUSTEDROOT`. That experiment was cleaned
up and was not repeated. It establishes that non-admin trust is insufficient for this full package.

The earlier loose registration remains useful architecture evidence but is not counted as
installation evidence.

Windows App Certification Kit could not run on this ARM64 host. The official Windows SDK
10.0.28000.2705 installer completed with WACK as the only selected top-level feature, plus
prerequisites it enforced. Its package plan restricted every WACK executable and native-component
package to x86 or amd64 hosts. On ARM64 it installed only the supported-API XML list and no
`appcert.exe`. No WACK report exists, so this is an environmental certification blocker rather than
a package pass or failure. Nothing has been associated, uploaded, submitted, or published.

## Production identity

The owner supplied these non-secret values after reserving **Recap Page** on 2026-08-28:

| Manifest field | Exact value |
|---|---|
| Package Identity Name | `PanelStackLabs.RecapPage` |
| Package Identity Publisher | `CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472` |
| Publisher display name | `PanelStack Labs` |
| Package family name | `PanelStackLabs.RecapPage_we33aa8nvkpcc` |

The maintained manifest uses those values exactly. Do not derive, shorten, or replace them.

Partner Center did not show a reservation expiration date. Treat 2026-11-28 only as a conservative
planning boundary derived from the reservation date, not as a portal-confirmed expiration.

## Activation architecture

```mermaid
flowchart LR
  Start["Start menu"] --> Launcher["architecture-matched node.exe and Launcher.mjs"]
  Launcher --> Node["same architecture-matched node.exe"]
  Node --> Server["unchanged loopback server"]
  Server --> Browser["external default browser"]
  Browser --> Origin["127.0.0.1:8787 browser storage"]
```

The Windows inbox .NET Framework compiler cannot target ARM64. An AnyCPU executable also runs under
x64 emulation on Windows on Arm unless it uses a Windows 11 24H2-only application-manifest setting.
That choice would either leave older package targets emulated or raise the Windows floor for both
bundle slices. A second native toolchain or launcher runtime would add another supply-chain surface.

The selected launcher therefore uses the official Node executable already required by each package.
The maintained JavaScript supervisor validates the packaged server, starts it with the package root
as its working directory, removes every casing of `MRT_PORT` and `MRT_NO_OPEN`, inherits the visible
console, waits for Node to exit, and keeps the output visible until a key is pressed. It does not
bind a port, open the browser, read browser storage, or write package files.

Three activation routes were measured or evaluated:

- **Direct manifest parameters** launched the correct Node command and opened the correct browser
  origin. A normal run had a visible console, but a busy-port failure exited Node and closed the
  console before its guidance could be read.
- **Package Support Framework** preserved the existing command wrapper and guidance. It was rejected
  because Microsoft states that the official NuGet binaries can send usage telemetry when Windows
  diagnostic collection is enabled. That conflicts with this app's no-telemetry promise.
- **The selected Node supervisor** preserves guidance without PSF, a downloaded launcher runtime, or
  an emulated entry process. The x64 and ARM64 package entry executables are the official native Node
  binaries already needed by the server.

The manifest declares only `runFullTrust`. It is needed because the package starts a classic desktop
process at medium integrity. Partner Center must review and approve that restricted capability.

## Build the local proof

Prerequisites:

- Windows 10 version 2004 or later
- Node.js 20 or later for repository tooling
- winapp CLI 0.6.0
- Windows Developer Mode for loose registration
- Administrator consent to trust the local proof certificate for `.msix` installation

Build the x64 and ARM64 Store packages, their bundle, and the isolated x64 update-proof package:

```text
npm run msix:pack
```

The build:

1. Fetches pinned official x64 and ARM64 Node runtimes.
2. Verifies both archives against Node's published SHA-256 list.
3. Stages native x64 and ARM64 version `2.0.0.0` package layouts.
4. Stages x64 version `2.0.0.1` under a separate proof-only output boundary.
5. Generates MSIX image assets from the maintained app icon.
6. Generates one random-password development certificate from the manifest.
7. Signs both Store packages, the bundle, and the proof-only update with that certificate.
8. Deletes the private PFX and password, leaving only the public CER for local trust.

The package layouts, runtime downloads, generated assets, and launcher inputs are staged under the
system temporary directory and removed after packaging. Only Store-safe version `2.0.0.0` artifacts
and the public CER remain under ignored `dist/msix/`; version `2.0.0.1` remains under ignored
`dist/msix-proof/`. Do not commit packages, certificates, logs, or proof reports.

Inspect the two packages, both bundle slices, PE machine fields, official Node executable hashes,
and live process architectures without installing anything:

```text
npm run msix:inspect
```

## Complete the installed proof

Open an elevated terminal and trust only the public proof certificate in TrustedPeople:

```text
Import-Certificate -FilePath .\dist\msix\RecapPage-local-proof.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

Then return to a normal terminal:

```text
npm run msix:prove -- --scenario=start-profile-reader-relaunch
npm run msix:prove -- --scenario=busy-port-refusal
npm run msix:prove -- --scenario=update-state-continuity
npm run msix:prove -- --architecture=arm64 --source=bundle --scenario=start-profile-reader-relaunch
npm run msix:prove -- --architecture=arm64 --source=bundle --scenario=busy-port-refusal
```

Each scenario owns its package installation and refuses to run when that package identity is already
registered. Cleanup re-queries and removes only the exact Recap Page identity, then fails if that
identity remains registered. Process enumeration, process stopping, package removal, and any
scenario-specific cleanup are attempted independently so one cleanup failure cannot skip another.

The same-profile journey must back up existing state before adding its non-sensitive sentinel and
must restore that backup afterwards. Proof output records only digests, byte lengths, process IDs,
the sentinel, and package generations. It must not record lists, notes, or raw storage.

The runner automates package installation, Start activation, console guidance, process ownership,
the exact origin, busy-port refusal, and package generation changes. Browser profile selection,
synchronous reader-tab behavior, and saved-state continuity are manual checkpoints recorded beside
the automated run; the runner does not claim to observe them.

The update scenario is x64-only because its `2.0.0.1` package is local proof material. The ARM64
package and final bundle contain only Store-safe version `2.0.0.0`.

The runner recursively prints every nested `AggregateError`. A failure that combines scenario and
cleanup errors preserves each cause before any decision to repeat it. Busy-port child exit is
witnessed by the known supervisor PID plus the child parent PID, executable name, and package path.
Missing ownership metadata is unknown and cannot report success.

## Run Windows App Certification Kit

Install the current Windows App Certification Kit from the official Windows SDK only after an owner
checkpoint. Microsoft documents the kit as an installed SDK component and requires an elevated
command window in an active user session. An SDK download layout is installation media, not a
supported portable certification environment, so copied binaries are not accepted as WACK evidence.

After approval, run WACK against the x64 package and the final bundle on a supported x64 host. The
x64 run can exercise the changed x64 entry payload, and the bundle run validates the submitted
container and both package manifests. It does not prove ARM64 runtime behavior on x64 hardware; the
installed ARM64 scenario on Windows on Arm is the separate runtime proof.

```text
appcert.exe reset
appcert.exe test -appxpackagepath <x64-msix> -reportoutputpath <temporary-x64-report>
appcert.exe reset
appcert.exe test -appxpackagepath <msixbundle> -reportoutputpath <temporary-bundle-report>
```

Treat manifest, binary architecture, capability, and package-content failures as package defects.
Treat missing kit components, lack of elevation or an active session, and machine policy failures as
environmental blockers. On this ARM64 host, the official 10.0.28000.2705 installer installs no WACK
executable, so another supported host is required. Performance results remain host-dependent and
must still meet the current Store policy. Keep reports outside the repository and delete any report
containing machine paths after recording only the test names and outcomes.

After the proof, remove the exact package:

```text
Get-AppxPackage -Name PanelStackLabs.RecapPage | Remove-AppxPackage
```

Remove the temporary trusted certificate in an elevated terminal, using the exact thumbprint from the CER:

```text
$thumbprint = (Get-PfxCertificate .\dist\msix\RecapPage-local-proof.cer).Thumbprint
Remove-Item "Cert:\LocalMachine\TrustedPeople\$thumbprint"
```

Confirm port 8787 is free and no `PanelStackLabs.RecapPage` package remains before deleting
`dist/msix/`.

## Browser storage and uninstall behavior

Package files are read-only. The launcher and server write nothing into the install directory.
Lists, notes, settings, overrides, read markers, IndexedDB metadata, and browser caches remain owned
by the external browser at the exact origin and profile.

Stopping, updating, uninstalling, or reinstalling the package does not remove that browser-owned
state. Clearing site data for `127.0.0.1:8787`, using another browser profile, changing the hostname,
or changing the port selects or destroys a different browser storage bucket.

The GitHub ZIP remains the public Windows download. The MSIX does not replace it until Store
certification passes and the owner explicitly changes release policy.

## Remaining Store gates

- Run the Windows App Certification Kit against the changed x64 package and final bundle on a
  supported host that receives `appcert.exe`.
- Approve the `runFullTrust` explanation in Partner Center.
- Use the dedicated [privacy policy](../PRIVACY.md) URL and review every listing disclosure.
- Complete Partner Center package validation.
- Review markets, age rating, listing copy, screenshots, legal terms, and certification notes.
- Upload and submit only after explicit owner approval.

The owner owns every Partner Center action. Repository automation never requests credentials,
accepts terms, reserves a name, uploads a package, or submits a listing.

## Official references

- [Application activation fields and packaged classic apps](https://learn.microsoft.com/uwp/schemas/appxpackage/uapmanifestschema/element-application)
- [App capability declarations](https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations)
- [MSIX app package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Package Support Framework](https://learn.microsoft.com/windows/msix/psf/package-support-framework)
- [Add Arm support to a Windows app](https://learn.microsoft.com/windows/arm/add-arm-support)
- [MSIX package and bundle requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Windows App Certification Kit](https://learn.microsoft.com/windows/uwp/debug-test-perf/windows-app-certification-kit)
- [winapp CLI multi-architecture bundles](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/usage#multi-architecture-bundles)
- [Node v24.19.0 published checksums](https://nodejs.org/dist/v24.19.0/SHASUMS256.txt)
