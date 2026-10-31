# Coordinated versions, independent releases

The product version names the shared app, a platform package names an installable build, and a
source revision identifies its code. None approves publication. Desktop and Android share the
main branch but can use different release dates and channels.

## Choose the product version and platforms

Keep the canonical product version in `package.json`. The npm version command synchronizes the
browser constant and generates bundled Home highlights from the finalized reader summary and exact
new catalog IDs, as described in [release preparation](MAINTAINING.md#1-finalize-the-release-record).
Highlights describe the running copy, not platform publication or an available upgrade. Their
viewing preference does not alter the reading schema or backup shape. Follow the existing
major/minor/patch compatibility policy.

| Change | Product version | Delivery decision |
|---|---|---|
| Shared compatible feature or interface improvement | Minor | Prepare affected desktop and Android builds independently; neither waits for the other's Store date. |
| Android-only behavior fix | Patch | Release Android only. Windows may skip this product version. |
| Windows-only behavior fix | Patch | Release Windows only. Android may skip this product version. |
| Catalog-only addition or correction | Patch | Release on the platforms that need the new bundled catalog; there is no remote catalog push or mandatory simultaneous release. |
| Substantial new product generation, or data an older build cannot read | Major | State compatibility explicitly for each affected platform and require backup/upgrade evidence. |
| Rebuild with unchanged source, or promotion of existing bytes | No product bump | A new Android build consumes a new code. Promotion reuses exactly the same artifact, code, source and hash. |

Apply [release bookkeeping](../GOVERNANCE.md#release-bookkeeping): collect complete feature records
in PR descriptions and linked Issues, then assemble the changelog in the final version release PR.
Do not bump the application version for every merge. Keep platform-specific fixes in shared history,
not permanent platform branches.

On Windows, product `x.y.z` becomes Store `x.y.z.0`. Reserve `.1` for the installed-upgrade proof
package; it must never enter the Store bundle. The first three components must fit Windows limits.
Store updates must exceed the live package version. For a replacement package, bump the product
patch, not the reserved fourth component. Windows has no independent version counter.

## Android allocation and exact-artifact contract

Use `packaging/android/version-codes.json` as the one append-only code ledger for all Android tracks.
Prototype betas retired codes through `3000002`. Reserve from `3000003`, advance by one and stop
at Play's `2100000000` limit. Abandoned reservations stay consumed. Never allocate codes from
product version, time, workflow run number or track.

Reserve against a full immutable commit already on main:

```text
node scripts/android-release.mjs reserve <full-source-sha>
```

Review and merge the ledger append before building. Merge reservations one at a time through main;
rebase competing reservations and rerun the history check before merging. CI rejects removed or
reassigned reservations and changed sealed hashes. The reservation commit comes after the source
commit. Build the pinned source with the approved ledger from the later main checkout, never the
reservation commit as substitute source.

Set `RECAP_ANDROID_LEDGER` to the approved ledger and `RECAP_ANDROID_VERSION_CODE` to the reserved
code. Gradle and asset preparation use the same Node contract. Both refuse dirty, wrong-version,
wrong-commit, wrong-tree, unreserved or already sealed source. The version name shows the product
version; About also shows the platform code and full source revision.

Inspect the actual package manifest and embedded `assets/recap/build-info.json` against the
reservation. Then record the final signed APK or AAB, never an intermediate unsigned artifact:

```text
node scripts/android-release.mjs record <artifact> <new-record.json>
node scripts/android-release.mjs verify <artifact> <record.json>
```

Recording seals the reservation to the exact basename, byte count and SHA-256. Merge the seal
before uploading. Keep the matching artifact and public-safe record together. A failed build,
changed signature, renamed artifact or rebuild needs a fresh reservation; never rebuild a sealed
code. Upload in allocation order, never an older reserved code after a newer one. Check the latest
approved ledger immediately before upload. Promotion changes only the store track, not the bytes:

```text
node scripts/android-release.mjs promotion <artifact> <record.json>
```

This checks exact sealed bytes, not package signature or structure. It never rebuilds, uploads
or approves a package. The separate manual
[Android candidate producer](ANDROID.md#protected-app-bundle-candidates) checks the signature,
contents and native behavior derived from that same AAB. It has no Play uploader and sets up
neither protected configuration nor key custody.

For normal Candidate dispatch, supply the mode, reserved code, genuinely observed Play high-water
and public evidence. The executing ledger determines the application source; source and ledger
SHA inputs remain optional checked compatibility pins. Resolved preflight outputs select the
actual application checkout and protected job environment.

The producer checks the executing and selected ledgers against current main, including after approval.
An old unsealed snapshot cannot override a newer seal. Version/record commands execute from the
selected application's checkout, not the later tooling checkout. Changing only the working directory
does not change their source identity.

Keep the four-file packet binding the final signed AAB, strict artifact record, separate public-safe
qualification record and proposed ledger seal. The qualification record distinguishes the upload
signer from disposable local APK signing. Apply only its verified seal to the matching entry in the
current ledger; preserve later reservations. Never rebuild or re-sign after qualification, replace
a newer ledger wholesale, or treat retained artifacts as upload approval.

Upload and track promotion need separate owner approval. First recheck the latest sealed ledger,
the retained AAB's signature/contents and actual Play code/track state. Stop on a failed or uncertain
upload; never retry or allocate blindly. Owner/account/signing/privacy/rights/device and Play testing
gates remain required.

Without a reservation, Gradle makes a **development** APK with code `3000002` and version name
`<product>-dev.<source-prefix>`, adding `-dirty` when applicable. Never upload it. Hosted synthetic
test APKs use disposable debug signing; identify them by source and final artifact digest, not an
invented beta release number.

## Build identity and reports

Packaged About text and `build-info.json` show only product/platform version, build channel,
source commit/tree and a dirty-source flag. A Windows build adds the SHA-256 of the cloud backup
client configuration it carries, or null, never the configuration. Artifact records add only
basename, size and digest.
Never include absolute paths, environment dumps, certificates, account identifiers, notes or backups.
`candidate` means clean build source, not Store approval or signing qualification.

A build carries a cloud backup client configuration only when its packager is given
`--cloud-client=<absolute path outside this repository>`. Both Windows packagers refuse any other
source, never read one from the environment, check it as the host will, and copy it byte for byte
beside the server; `cloud-client.json` is ignored, so a copy left in the checkout is never committed.
Ordinary PR, diagnostic and Android rehearsal builds pass none and leave cloud backup off.
Approved Windows release preparation and Store builds, including read-only Store Validate,
use the protected inputs below. Both the portable verifier and MSIX inspection validate the
carried configuration and require its exact SHA-256 in `build-info.json`.

### Protected OneDrive release inputs

The owner creates these **environment secrets on GitHub**, never sends their values
through chat and never copies withheld evidence into a build:

| Environment | Secret | Value entered by the owner |
|---|---|---|
| `microsoft-store-production` | `RECAP_ONEDRIVE_CLIENT_ID` | Read the Application (client) ID from the personal-account app's Entra Overview at that time. |
| `android-release-candidate` | `RECAP_ONEDRIVE_CLIENT_ID` | The same Entra Application (client) ID. |
| `android-release-candidate` | `RECAP_ONEDRIVE_PLAY_REDIRECT_HASH` | The already registered, unencoded base64 SHA-1 Android redirect hash for the Play app signing certificate, not the upload certificate. |

These are public-client identifiers carried by installed packages, not client
passwords. The owner's rule still keeps them out of source, Issues, PRs and logs.
Do not add a client secret. Both environments keep their owner reviewer and exact
`main`-only branch policy. Creating or changing a secret or environment is an owner
operation, not a workflow side effect.

The checked release wrapper generates this JSON outside the checkout; placeholders
below show the shape only, never values to paste back to an agent:

```json
{
  "format": "recap-page-cloud-client",
  "version": 1,
  "providers": {
    "onedrive": {
      "clientId": "<Application client ID entered directly on GitHub>",
      "authority": "consumers"
    }
  }
}
```

Missing or invalid inputs fail the approved build; they never fall back to a
disabled release. Configuration is scoped to the package preparation step and
removed in its `finally` path and an independent `always()` cleanup. Windows
release preparation protects the enabled WACK and installed-proof package jobs
as well as the portable ZIP. Ordinary WACK stays secret-free.

Android Candidate uses a private redirect file, not a secret-bearing Gradle
argument. Configured Gradle output is private scratch and is deleted even on
failure; only a bounded failure message reaches the job log. Same-AAB manifest
inspection checks the exact redirect activity, its client metadata, registered
hash and browser intent against the external input. Qualification version 2
records only the SHA-256 of the UTF-8 compact JSON object
`{"clientId":value,"redirectHash":value}` in that property order, with no trailing
newline. Signed-artifact identity and the ledger still bind the final AAB bytes;
the existing source identity is unchanged. The publisher continues to verify
historical version 1 qualification packets without inventing configuration
evidence for them. Neither synthetic signing nor an emulator proves Play-signed
Microsoft sign-in; the physical pass on the final closed-testing build does.

Local test copies keep their separately registered signing redirect. Supply the
existing external config property and the matching debug redirect, either as
`recapCloudRedirectHashDebug` or `recapCloudRedirectHashDebugFile` (an external file
containing exactly the 28-character unencoded hash, without a newline). A Play
redirect must never be substituted for the local debug certificate's redirect.

The source checkout states that its revision is not embedded. Packagers stamp only generated output.
Portable Windows writes `dist/windows-artifact.json`; MSIX writes `dist/msix/windows-artifact.json`.
Use hosted portable provenance and its exact-byte verifier for the retained release candidate.
Android native CI keeps `android-artifact.json` beside the verified debug APK.

## Independent publication gates

**Microsoft Store release is manual-only from the default branch.** GitHub releases, Android tags,
test workflows and artifact uploads never request Store deployment. The default is `Validate`,
a read-only rehearsal. `Submit` requires an existing stable `v<product>` release, full source SHA,
default-branch ancestry, existing protected owner approval, package inspection/WACK and the live
free-product/pending-draft/higher-version checks. The publisher verifies the exact bundle before
mutation. Normal Submit combines these quality checks and submission in one run; a separate
Validate or incident-recovery run is not a routine release prerequisite. Never dispatch this
workflow to test triggers.

The Android synthetic CI job is opt-in, with no store credentials or publication authority.
Choose `native_mode=debug` or `native_mode=rehearsal`, never both; the default is `none`.
Rehearsal derives the exact executing SHA. Deprecated legacy flags remain checked compatibility
aliases, not additional modes to combine. Use that registered manual entry before
merge; a new manual workflow cannot be dispatched until it exists on the default branch.
Windows dispatch cannot launch Android proof.

Candidate signing requires direct manual dispatch of its own workflow on main, an existing protected
environment and human approval bound to that run. It is separate from rehearsal and the protected
Play testing uploader. There is no generic `release: published` subscription. Android prereleases keep
`android-v...` tags; `v...` identifies the desktop GitHub release expected by Windows submission.

The [protected Play testing publisher](GOOGLE_PLAY_PUBLISHING.md) consumes the exact retained
packet after its seal is merged. Its default performs validation without Google access; every
Google operation requires separate human approval. It rejects production tracks and reports
submission separately from actual user availability.

Normal Publish supplies the mode, one named Candidate run, actual testing track and plain notes.
It resolves the sealed packet identity and captures a supported simple target inside the approved
edit, so no prior Inspect is required. Signing and exact-artifact publishing still require two
separate credential approvals, and both reviewed ledger merges remain. Promote requires an
explicit target-state digest. No concurrent publisher or pending Console work may exist:
Google can also submit Console changes already ready for review when the API edit commits.

## Delivered release matrix

Desktop delivery evidence checked 2026-10-08 UTC; Android rows retain their 2026-09-29 evidence.
Update each row only after observing its own delivery, not merely
after building, merging, uploading or requesting certification. Preserve original build provenance
when an artifact was built before its release tag.

| Platform/channel | Product/package | Source and delivery evidence | Status |
|---|---|---|---|
| Windows portable, GitHub stable | 4.0.0 / portable 4.0.0 | [v4.0.0](https://github.com/raymond-nassar/recap-page/releases/tag/v4.0.0), artifact source `27b00929f47db188fa94f26dcf0536389d0807f8`, later release tag `1bc436d9488f65f8230e4e6ba4594bbcf0d15d26`; both share tree `1eeecbff5a4a9a315c8b00e732ea5d6f00711cb9`. ZIP SHA-256 `96e15db9f7579246e617ca97f8da25c7d8b6a5256555156609e6214cae536ee8` | Published 2026-10-08. |
| Microsoft Store, production | 4.0.0 / 4.0.0.0 | [Owner delivery confirmation](https://github.com/raymond-nassar/recap-page/pull/748#issuecomment-6062078462), following [run 37783966719](https://github.com/raymond-nassar/recap-page/actions/runs/37783966719), submission `1152921505702075190`, source `1bc436d9488f65f8230e4e6ba4594bbcf0d15d26`, bundle SHA-256 `7f8f9120c233ff2f59dc3947751165b021fe2f186f3058a6967d0278670256e9` | Owner confirmed available and installed 2026-10-08; not inferred from submission success. |
| Android, GitHub sideload beta | 3.0.1 / 3.0.1-beta.2, code 3000002 | [Beta 2](https://github.com/raymond-nassar/recap-page/releases/tag/android-v3.0.1-beta.2), source `b174688c53b9f129aafc40d5763b939430a279e3`, APK SHA-256 `67c663cb00356bfe972076b86b6ee2686fee3fdffa4830c8f5a12f11218b7187` | Published 2026-09-28; prototype signing, not sustainable Play update identity. |
| Android, hosted development | 3.0.1 / legacy beta label, code 3000002 | [Run 36510133212](https://github.com/raymond-nassar/recap-page/actions/runs/36510133212), source `fd10803c1d316686d1dfaad8b16f911f4d9eed1f` | Test-only artifact, not a later public beta or a Play release. |
| Android, Google Play | None | [Publication roadmap](https://github.com/raymond-nassar/recap-page/issues/570) | Not enrolled or published by this work. |

## Upgrade and backup compatibility

Keep `http://127.0.0.1:8787/`, the data model and explicit progress actions unchanged.
Matching URLs do not merge Windows browser, Android WebView and Android browser storage. There is
no cloud sync. Before changing installation identity or signing, export a backup and keep it
independently. Uninstall removes Android app data. Restore backups deliberately; they never merge
automatically. Identity/signing and safe beta migration belong to
[#576](https://github.com/raymond-nassar/recap-page/issues/576), not version policy.

## First-party rules

Retrieved 2026-09-29:
- [Android versioning](https://developer.android.com/studio/publish/versioning): increasing codes,
  nonreuse and the Play limit.
- [Windows package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements):
  Store-reserved fourth component and platform version constraints.

## iOS allocation and exact-artifact contract

The append-only `packaging/ios/build-numbers.json` ledger owns all iOS build numbers. Development
build 1 is retired from distribution. Reserve consecutively from 2, independently of product
version, run number and time. Abandoned and failed reservations remain consumed. The current
single-component format stops at 9999 rather than inventing a new numbering scheme.

```text
node scripts/ios-release.mjs reserve <full-source-sha>
node scripts/ios-release.mjs history
```

The full source commit must already be on main, with its tree and product version matching the
reservation. It must also already contain this ledger and the reservation-aware build stamping,
because the export runs the source's own preparation: an older main commit would sign, then fail
its identity check and consume the number.
Merge reservations one at a time through main before building. CI checks the ledger's
first-parent history as well as the working copy and refuses removal, reuse, reassignment, a
changed seal or a source introduced after its reservation. Merge main into competing branches
and recheck; do not overwrite newer reservations.

The [protected TestFlight workflow](IOS.md#signing-and-internal-testflight) runs manually on main
only. Its export and upload modes are separate runs and require separate owner approvals in the
existing, owner-created `ios-testflight` environment. Preflight refuses missing or unreadable
owner-review/main-only protection without creating configuration. Approval permits only that
run's selected mode; neither a reservation nor an artifact is upload permission.

Export builds the reservation's clean source in a separate checkout with the later approved ledger.
`RECAP_IOS_BUILD_NUMBER` and `RECAP_IOS_LEDGER` bind preparation to that reservation; native build
settings use the same build number and product version. About and the bundled build identity
must agree. Export produces a signed IPA on disk, never uploads, and retains it with a strict
artifact record and proposed seal for 30 days.

For an independently inspected final signed IPA, the record and proposed seal can also be made
without signing or uploading:

```text
node scripts/ios-release.mjs record <ipa> <new-record.json>
```

Set those two environment variables first. The record command does not mutate the ledger or prove
the signature; it writes the proposed ledger beside the record with `.proposed.json` appended.
Review and merge only the matching seal into the latest ledger. The seal fixes the IPA's basename,
byte count and SHA-256. A changed signature, renamed file or rebuild requires a fresh number.
Never rebuild a sealed reservation or substitute the reservation commit for the source commit.

```text
node scripts/ios-release.mjs verify <ipa> <record.json>
```

Verification checks the exact merged seal and candidate identity, not just a self-supplied hash.
Upload mode downloads the packet from the selected successful export run of this workflow on
main, rechecks the current main ledger after approval, verifies exact bytes, then calls altool once.
It does not rebuild or re-sign. Every mode refuses workflow reruns and previously attempted numbers
in that mode, including failed attempts. After a failed or uncertain upload, inspect Apple state;
do not retry blindly. Upload in allocation order and confirm Apple's current build state before
approval. The upload receipt records source, seal, run IDs, upload date and upload-plus-90-days
estimated expiry; confirm Apple's actual expiry after processing.

Never retain signing keys in artifacts, source or public records. The API key exists in protected
environment secrets and runner scratch only, with always-run deletion. Certificate/profile signing
from Windows and Transporter or Build Upload API uploading remain documented fallbacks, not an
automatic alternate path around a refusal. Real signing, processing, installation, expiry and
update-in-place behavior remain delivery evidence, not facts established by the tooling tests.

## 4.3.0 Windows Store owner handoff

The separate **4.3.0 Store bundle handoff** workflow prepares an owner-upload packet,
not a submission or public release. Implementation of this route is not permission
to dispatch it. The owner must separately approve building and transferring, bound
to the explicit release commit/tree on main, reviewed executing workflow revision,
and repository-owner Partner Center recipient. Both approvals may precede the build;
the exact bundle digest is checked after qualification. Do not select an unmerged
version PR head or assume it will become the release commit.

The existing `microsoft-store-production` environment remains the protected gate.
The only protected input is the existing OneDrive client ID secret, supplied through
the release wrapper. An independently calculated configuration digest must match
every standalone, proof and bundled package inspected. Missing or invalid input,
wrong source/version, unqualified WACK, changed bytes or failed pre-transfer cleanup
blocks the artifact. The historical 2.1.0 draft handoff remains separate and unchanged.

The owner accepted short public access without encryption. Retain only the
4.3.0.0 x64/ARM64 bundle and strict public-safe receipt for **one day**. Arrange the
owner's download and upload within that window before approving a run; if that is
not possible, stop and obtain a retention decision rather than dispatching or extending
retention silently. This does not change the portable candidate's one-day retention
or the Android candidate's seven-day closed-testing handoff window.

The receipt binds release commit/tree, workflow commit/tree/blob digest and run,
recipient/purpose, configuration digest, structural inspection and WACK results,
bundle size/hash and plaintext retention. It contains no configuration bytes,
client ID, redirect hash, credentials, signer details or personal data. The bundle
necessarily carries the configured public-client identifier, as an installed release
does; accepting plaintext bundle access does not permit printing that identifier.
Raw build, inspection and WACK output is private scratch and is never retained.
Only a completely successful run, including final cleanup, is eligible for handoff.
Owner upload, draft read-back, certification and publication still require their
own authority; no artifact or receipt supplies it.
