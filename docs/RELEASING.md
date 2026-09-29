# Coordinated versions, independent releases

One product version describes the shared app. A platform package identifies an installable build,
and a source revision identifies the code it contains. None of these is a publication approval.
Desktop and Android use the same main branch; their release dates and channels need not match.

## Choose the product version and platforms

The canonical product version remains `package.json`, synchronized with the browser constant by
the existing npm version command. Use the existing major/minor/patch compatibility policy.

| Change | Product version | Delivery decision |
|---|---|---|
| Shared compatible feature or interface improvement | Minor | Prepare affected desktop and Android builds independently; neither waits for the other's Store date. |
| Android-only behavior fix | Patch | Release Android only. Windows may skip this product version. |
| Windows-only behavior fix | Patch | Release Windows only. Android may skip this product version. |
| Catalog-only addition or correction | Patch | Release on the platforms that need the new bundled catalog; there is no remote catalog push or mandatory simultaneous release. |
| Substantial new product generation, or data an older build cannot read | Major | State compatibility explicitly for each affected platform and require backup/upgrade evidence. |
| Rebuild with unchanged source, or promotion of existing bytes | No product bump | A new Android build consumes a new code. Promotion reuses exactly the same artifact, code, source and hash. |

Product changes can accumulate under Unreleased before a release is selected. Do not bump for
every merge. Platform-specific fixes still belong in shared history, not permanent platform branches.

Windows retains the existing derivation: product `x.y.z` becomes Store `x.y.z.0`; `.1` is only the
installed-upgrade proof package and must never enter the Store bundle. The first three components
must fit the existing Windows limits. A new Windows Store update must exceed the live package
version; use a new product patch for a replacement package rather than consuming the reserved
fourth component. This is intentionally not an independent arbitrary Windows counter.

## Android allocation and exact-artifact contract

`packaging/android/version-codes.json` is the single append-only allocation ledger across Android
tracks. Codes through `3000002` are retired by the prototype betas. New reservations start at
`3000003`, advance by one and stop at Play's `2100000000` limit. Abandoned reservations stay consumed.
Neither product version, time, workflow run number nor track allocates a code.

Reserve against a full immutable commit already on main:

```text
node scripts/android-release.mjs reserve <full-source-sha>
```

Review and merge that ledger append before building. Serialize reservations through main, rebase
competing reservations and rerun the history check before merging. CI rejects removing/reassigning
existing reservations or changing sealed hashes. The reservation commit is intentionally later
than the source commit: build the pinned source, using the approved ledger from the later main
checkout, not the reservation commit as substitute source.

Set `RECAP_ANDROID_LEDGER` to that approved ledger file and `RECAP_ANDROID_VERSION_CODE` to the
reserved code. The Gradle configuration and asset preparation both read the same Node contract.
They refuse dirty, wrong-version, wrong-commit, wrong-tree, unreserved or already sealed source.
The displayed version name is the product version; About also identifies the platform code and
full source revision.

After inspecting the actual package's manifest and embedded `assets/recap/build-info.json` against
the reservation, record the final signed APK or AAB, not an intermediate unsigned artifact:

```text
node scripts/android-release.mjs record <artifact> <new-record.json>
node scripts/android-release.mjs verify <artifact> <record.json>
```

Recording seals the reservation to the exact basename, byte count and SHA-256. Merge that seal
before any upload. Retain the matching artifact and public-safe record together. A failed build,
changed signature, renamed artifact or rebuild needs a fresh reservation; a sealed code cannot
be built again. Upload new builds in allocation order, never upload an older reserved code after
a newer one, and use the latest approved ledger immediately before upload. Promotion changes
only the store track, not the bytes:

```text
node scripts/android-release.mjs promotion <artifact> <record.json>
```

This command verifies the exact sealed candidate and does not rebuild, upload or approve it.
No Play uploader, production identity, signing key or protected Android deployment is created here.
Issue [#578](https://github.com/raymond-nassar/recap-page/issues/578) must wire these contracts into
one serialized protected producer/uploader, verify package metadata after signing, retain artifacts,
recheck the latest ledger and store code high-water mark, and distinguish first upload from
track promotion. It must fail closed on an uncertain upload response, not allocate/retry blindly.
Owner/account/signing/privacy/rights gates remain required.

Without a reservation, Gradle deliberately makes a **development** APK with code `3000002` and
version name `<product>-dev.<source-prefix>`, adding `-dirty` when applicable. This is not an
upload candidate. Hosted synthetic test APKs use disposable debug signing and are identified by
their source and final artifact digest, not by an invented beta release number.

## Build identity and reports

Packaged About text and `build-info.json` expose only product/platform version, build channel,
source commit/tree and a dirty-source flag. Artifact records add only a basename, size and digest.
No absolute path, environment dump, certificate, account identifier, notes or backup belongs there.
`candidate` means clean build source, not Store approval or signing qualification.

The source checkout says explicitly that its revision is not embedded. Packagers stamp generated
output only. Portable Windows writes `dist/windows-artifact.json`; MSIX writes
`dist/msix/windows-artifact.json`. Existing hosted portable provenance and its exact-byte verifier
remain authoritative for the retained release candidate. Android native CI retains
`android-artifact.json` beside the verified debug APK.

## Independent publication gates

**Microsoft Store release is manual-only from the default branch.** No GitHub release, Android tag,
test workflow or artifact upload requests a Store deployment. `Validate` remains the default
read-only rehearsal. `Submit` requires an existing stable `v<product>` release, its full source SHA,
default-branch ancestry, existing protected owner approval, package inspection/WACK and the
existing live free-product/pending-draft/higher-version checks. The publisher still verifies the
exact bundle before mutation. Do not dispatch this workflow to test trigger behavior.

The Android synthetic CI job remains explicit opt-in and has no store credentials or publication
authority. Windows dispatch cannot launch it. Future Play workflows must have a separate protected
environment and explicit immutable artifact selection, never a generic `release: published`
subscription. Existing Android prereleases retain their `android-v...` tags; `v...` continues to
identify the desktop GitHub release expected by Windows submission.

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

Keep `http://127.0.0.1:8787/`, the existing data model and explicit progress actions unchanged.
Matching URLs do not merge Windows browser, Android WebView and Android browser storage. No cloud
sync is introduced. Before changing installation identity or signing, export and independently keep
a backup. Uninstall removes Android app data; a backup must be restored deliberately and is not
an automatic merge. Identity/signing and safe beta migration remain
[#576](https://github.com/raymond-nassar/recap-page/issues/576), not a choice made by version policy.

## First-party rules

Retrieved 2026-09-29:
- [Android versioning](https://developer.android.com/studio/publish/versioning): increasing codes,
  nonreuse and the Play limit.
- [Windows package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements):
  Store-reserved fourth component and platform version constraints.
