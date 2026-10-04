# Coordinated versions, independent releases

The product version names the shared app, a platform package names an installable build, and a
source revision identifies its code. None approves publication. Desktop and Android share the
main branch but can use different release dates and channels.

## Choose the product version and platforms

Keep the canonical product version in `package.json`. The npm version command synchronizes the
browser constant. Follow the existing major/minor/patch compatibility policy.

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

The producer checks the selected later ledger against current main, including after approval.
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
source commit/tree and a dirty-source flag. Artifact records add only basename, size and digest.
Never include absolute paths, environment dumps, certificates, account identifiers, notes or backups.
`candidate` means clean build source, not Store approval or signing qualification.

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
mutation. Never dispatch this workflow to test triggers.

The Android synthetic CI job is opt-in, with no store credentials or publication authority.
Choose debug or secret-free AAB rehearsal, never both. Use that registered manual entry before
merge; a new manual workflow cannot be dispatched until it exists on the default branch.
Windows dispatch cannot launch Android proof.

Candidate signing requires direct manual dispatch of its own workflow on main, an existing protected
environment and human approval bound to that run. It is separate from rehearsal and any future
Play uploader. There is no generic `release: published` subscription. Android prereleases keep
`android-v...` tags; `v...` identifies the desktop GitHub release expected by Windows submission.

## Delivered release matrix

Evidence checked 2026-09-29 UTC. Update each row only after observing its own delivery, not merely
after building, merging, uploading or requesting certification. Preserve original build provenance
when an artifact was built before its release tag.

| Platform/channel | Product/package | Source and delivery evidence | Status |
|---|---|---|---|
| Windows portable, GitHub stable | 3.0.1 / portable 3.0.1 | [v3.0.1](https://github.com/raymond-nassar/recap-page/releases/tag/v3.0.1), artifact source `64a7cd11d663d9a822660f25b656cf1019ce5f7d`, later release tag `26164bc51fcd8c6f4b986ccedf05695907ffdd89`; attached preparation record and ZIP SHA-256 `f2640568088246d9b27a11a6c1100e185ebff868e0585653c4bd139d72517ce8` | Published 2026-09-20. |
| Microsoft Store, production | Live version not reverified in this task | [Store packet completion](https://github.com/raymond-nassar/recap-page/issues/368#issuecomment-5521178746); later [2.1.0 submission record](https://github.com/raymond-nassar/recap-page/issues/488#issuecomment-5644530944) reports certification, not publication | Existing channel. Do not infer live version/source from a GitHub tag or workflow success. Owner read-back is required before the next Store update. |
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
