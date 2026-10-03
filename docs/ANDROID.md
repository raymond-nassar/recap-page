# Android prototype

This experimental version of Recap Page can be sideloaded on Android. It is not a Google Play
release. It uses the existing app and reading lists with larger text and touch targets, without
adding accounts, synchronization or reading features, or changing the saved-data format. The supported
desktop installation and Windows release process are unchanged.

Give volunteer testers [the short Android beta checklist](ANDROID_BETA.md). No development tools
are needed. Restore tests are optional and use throwaway data.

[Google Play asset previews](GOOGLE_PLAY_ASSETS.md) has original artwork and fictional, cover-free
phone layouts for maintainers. These desktop-rendered previews are not native device acceptance
or an approved Play listing.

**Android viability is not yet confirmed on a physical device.** Building an APK and checking
web screens in a desktop browser do not prove Android file pickers, background recovery or
Marvel Unlimited reader compatibility. Complete the device checks below before distribution.

## How it works

The optional `packaging/android` project bundles current `src` files at build time, with
Android-only CSS and an entry module in the generated assets. There is no second app copy to
maintain; shared fixes reach both versions.

Android's WebView loads those assets at `http://127.0.0.1:8787/` inside the app. There is no Node
server, listening port or remote app host, and no computer needs to stay on. The address uses the
app's private WebView storage, **not** desktop browser or Android Chrome storage. The same
address does not mean shared progress.

Lists, notes, availability overrides and progress work as before. Bundled reading lists work
offline; metadata lookups and Marvel's reader need an internet connection. The app does not
download comics or provide offline comic reading.

### Phone navigation and controls

On narrow Android screens, the menu button shows only its icon and keeps its **Navigation**
screen-reader name and 48px minimum touch target. The top bar is the only app branding, with
the full app icon and no selected-page stripe. Home keeps **Browse. Choose. Read.** as its
visible, focusable heading instead of repeating the large logo.

Home offers **Browse Reading Lists** and **Add comics**, without a Setup recommendation.
The existing Setup guide remains on Modern Timeline and the other browse pages.
Its short introduction keeps the guide optional; **About this starting point** opens the full
historical explanation.

The link above a page title opens its immediate parent, such as **Browse** or **Library**.
It replaces the full breadcrumb trail and current title. Android Back follows your history;
the parent link goes to its named destination.

On a Reading List, open **List options** to rename, edit notes, duplicate, export, manage metadata
or delete. Export choices expand inside the bottom sheet. Choosing an action closes the sheet
before opening its editor or confirmation. **Close**, Android Back, Escape or a tap outside
dismisses the sheet without taking action.

Read and **Done, next** stay together. **About this comic** opens reader-focused details with Read
near the title, useful comic information and optional, spoiler-protected story summaries.
**More comic actions** contains deferral and the external comic page.
**Trouble opening this comic?** contains the full Unlimited status and reader-link help, rather than
putting availability in the main comic details. An active temporary-link warning stays
visible outside that disclosure, and editing still requires a matching saved comic.

Add leads with search and series, with other methods under **More ways to add**. An empty search
offers **Add an issue by hand** directly. Settings put **Download backup** and restore first,
with optional exports under **Checklist and sharing options** and metadata configuration under
**Advanced**. Recovery copies, undo and error reports remain available.

Swipe the single row of compact filter chips sideways to reach more choices. Keyboard focus scrolls its choice
into view. The selected chip is underlined as well as colored. Filter meanings, counts and
reading-filter history are unchanged.

Touch navigation keeps screen-reader heading focus without a focus rectangle. Keyboard focus
stays visible. Wider Android windows keep inline list actions and the full breadcrumb trail.
These phone navigation controls do not change desktop layout or saved data.

### Marvel Unlimited app links

**Read** opens the isolated local launcher immediately. If no digital issue ID is recorded and
metadata lookup was already refused for an exact matching Marvel issue page, it opens that page
in a browser without another lookup. Otherwise, a missing digital issue ID is requested from the
configured metadata service.

The launcher then asks Marvel's anonymous Bifrost legacy resolver for the app's issue identifier.
It opens only a validated issue link in the `com.marvel.unlimited` package. The combined lookup
has an eight-second timeout. Empty, ambiguous or invalid results and failed requests show an
explanation, not a guessed link.

The launcher stays open after handing off to Marvel Unlimited. If Marvel shows a loading error
or the wrong screen, return to Recap Page and choose **Open in browser**.
**Try Marvel Unlimited again** reuses the validated link without another lookup.

Browser escape uses an installed browser, with a choice when several are available. It does not
send the fallback to an arbitrary app-link handler. Cancellation, a missing browser or a failed
launch leaves the launcher usable. Choosing a browser during lookup cancels the lookup and
prevents a delayed app launch.

Browser discovery requests all choices with a hostless HTTPS query, not the comic's domain.
An approved app-link handler or default browser therefore cannot hide other browsers. The comic
URL is attached only when launching the selected browser.

Recap Page does not sign in to Marvel, embed comic pages or verify what Marvel's app displays.
Opening the app or issue page does not prove the comic loaded. Record progress manually with
**Done, next**. Desktop uses the same validated issue-page fallback without a redundant metadata
lookup.

The extra request sends the digital ID and exposes your network address to `bifrost.marvel.com`.
It omits credentials and referrers and uses no-store. Recap Page does not save the returned
identifier or send lists, notes or progress. The endpoint is undocumented; support, coverage and
usage limits are not guaranteed. Browser escape remains available if the service, app or comic
cannot be opened. See [the privacy policy](../PRIVACY.md).

The resolver mechanism was discovered through
[Naouak/reading-lists](https://github.com/Naouak/reading-lists/blob/158a6366269966c79fe3a4daeed89cace5edc9fa/backend/library/views/redirects.py),
inspected on 2026-09-28. This implementation is independently authored; no upstream source was
copied or translated. No source-reuse license was found for that repository, and this reference
is discovery credit, not a claim of permission or affiliation. It does not establish terms for
Marvel's service.

## Build and install

The Java-only Android module uses `enableKotlin = false` to disable AGP 9.4.1's built-in Kotlin
integration at module level. Without it, AGP can add the Kotlin standard library even when
compilation reports `NO-SOURCE`. Explicit instrumentation-test dependencies are unchanged;
application DEX checks still reject foreign runtime classes. See the official
[Java-only module guidance](https://developer.android.com/build/migrate-to-built-in-kotlin)
and [AGP 9.4 API](https://developer.android.com/reference/tools/gradle-api/9.4/com/android/build/api/dsl/CommonExtension),
read on 2026-09-30. This setting does not by itself prove a rebuilt artifact or test harness passes.

**Feature-first release gate:** new releases may start only after the accepted mobile features
are finished and verified. Preparing source does not authorize a build. Before bumping a version,
reserving a release code, creating an APK/AAB, distributing a build or uploading/promoting a
candidate, record the integrated feature source and applicable execution approval. See
[the conditional owner authorization](https://github.com/raymond-nassar/recap-page/issues/570#issuecomment-5906215612).

Prerequisites:

- Node.js 20 or newer, as for the source project.
- JDK 17 or newer compatible with the pinned Gradle version; development uses JDK 21.
- Android SDK Platform 36 and the build tools requested by the Android Gradle plugin.
- A physical Android device running Android 8.0 or newer, with an up-to-date Android System
  WebView. The minimum OS version alone does not guarantee a sufficiently recent web engine.

Set `ANDROID_HOME` to your SDK directory, or create an untracked
`packaging/android/local.properties` with its `sdk.dir`. Install SDK components and review their
licenses using Android Studio or the SDK manager.

From the repository root on Windows:

```powershell
.\packaging\android\gradlew.bat -p packaging\android assembleDebug assembleDebugAndroidTest lintDebug policyTest
```

On first use, the Windows wrapper restores its checksum-verified Gradle launcher locally.
It downloads build tooling, not app data. On other hosts, use installed Gradle 9.8.0 or restore the
official wrapper JAR with the checksum recorded in `bootstrap-wrapper.ps1` before using `gradlew`.
Builds prepare assets automatically. To prepare them without an Android SDK:

```text
npm run android:prepare
```

The debug APK is at `packaging/android/app/build/outputs/apk/debug/app-debug.apk`.
Transfer it to the test phone and install it. Allow that source when Android asks.
Alternatively, use `adb install -r` with the APK path and an explicitly selected test device.

This debug build is not production-signed. To update a test installation in place, keep its
signing key and application ID. A different signature cannot update it in place;
**export a backup before uninstalling**. Keep build outputs, SDK paths and signing keys out of
Git. Prototype downloads are Android-only GitHub prereleases, not store uploads.

The published Beta 2 used version name `3.0.1-beta.2` and code `3000002`. New builds follow the
[coordinated release policy](RELEASING.md): local and hosted debug builds are development builds;
distribution candidates need a source-bound code reservation. When reporting a problem, include
the APK filename and About's product version, platform build and source revision.
These identify source and platform builds, not a qualified signer. The identity and signing
model are approved, but enrollment is pending.

Dependabot watches the Android Gradle toolchain separately. When updating Gradle, review the
distribution checksum and wrapper checksum/bootstrap version together. Then rerun the APK build,
Android lint and policy checks.

## Official identity and signing preparation

[The owner approved separate identities](https://github.com/raymond-nassar/recap-page/issues/576#issuecomment-5895064801)
so a future official installation can sit alongside the prototype during progress transfer.

| Source configuration | Application ID | App label |
|---|---|---|
| Official/default release | `io.github.raymondnassar.recappage` | Recap Page |
| Debug prototype | `io.github.raymondnassar.recappage.prototype` | Recap Page prototype |

Debug adds `.prototype` to the default official application ID. The Java namespace and native
test classes remain `io.github.raymondnassar.recappage.prototype`. Test APK and document-provider
identities follow the selected debug or release target. The unchanged `.MainActivity`
declaration resolves against the Java namespace, not the installed application ID.
The standard debug resource override keeps the prototype label. See
[Android's documented identity rules](https://developer.android.com/build/configure-app-module),
[Activity naming rules](https://developer.android.com/guide/topics/manifest/activity-element#nm)
and [source-set rules](https://developer.android.com/build/build-variants#sourcesets),
retrieved 2026-09-29.

**Gradle release signing is intentionally not configured.** Release stays unsigned,
non-debuggable and unshrunk. The protected producer signs the AAB outside Gradle without inheriting
the debug signer. Debug signing is disposable; differently signed old betas cannot update in
place. An official application ID or source-bound candidate record does not approve signing
or publication.

The selected model is **Google-managed Play App Signing with a separate upload key**.
Google's app-signing key signs Play installations. The upload key authenticates uploads; an APK
signed only with it cannot replace a Play-signed update. For occasional distribution outside Play,
Google permits downloading a Play-signed universal APK from Play Console or the Play Developer API.
Building and signing production updates independently of Google's output would require a different
custody decision. That is not the selected model. See
[Play App Signing](https://developer.android.com/studio/publish/app-signing)
and [Google's signing and distribution guidance](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en-CA),
retrieved 2026-09-29.

This preparation has not created or enrolled a key. Enrollment, public certificate fingerprints,
upload-key ownership and backup/recovery, and least-privilege CI access still need owner-approved
work in [the signing issue](https://github.com/raymond-nassar/recap-page/issues/576).
Never put private keys, passwords, identity documents or private Console identifiers in source,
issues, logs or artifacts. The owner has reported verification of the new Personal Play account;
that does not establish app-specific production access or permission to publish.

Portable identity checks inspect source declarations, not Android installations. The producer
also requires artifact inspection and native evidence from the same bundle. Implemented source
is not a passing result. Production-key update continuity, real-user migration, physical
acceptance and release-wide copy review remain separate gates. The prototype runtime and private
storage identity are unchanged.

## Protected App Bundle candidates

The manual **Android release candidate** workflow builds and validates candidates. It has no
Play uploader and never publishes on merge. Having its source does not mean signing is
provisioned, a key is enrolled, native tests passed or a release is approved.

Before its first merge to the default branch, rehearse through the registered **CI** workflow.
A new `workflow_dispatch` file cannot be dispatched just by naming a feature branch with `--ref`.
After clearing the feature/execution gate and pushing, use the actual branch and full source
commit in place of these placeholders:

```text
gh workflow run CI --ref YOUR_BRANCH -f android_emulator=false -f android_rehearsal=true -f android_rehearsal_source_sha=FULL_SOURCE_SHA
```

The two native flags default off and cannot be combined. Ordinary push/PR jobs and debug-emulator
mode remain separate. CI passes literal Rehearsal mode to the shared producer without a protected
environment or upload credentials. Rehearsal keeps only a sanitized JSON report, never a bundle,
APK or signing key. Before relying on a result, read back its workflow path, run/attempt, branch
and source SHA.

If native Rehearsal fails, the runner preserves the first nonzero instrumentation,
`tee`, checker or receipt-stage exit and stops before the next phase. It can retain one separate
`android-native-failure.json` capsule with `qualified: false`, never an accepted rehearsal report.
After signing cleanup, both manual Rehearsal workflows validate the capsule's exact owned path,
source/run identity, closed schema and 256 KiB size limit before uploading that file.
Candidate jobs do not keep failure capsules.

The capsule contains bounded instrumentation facts, actual owned target/phase agreement, guest
liveness, UID-filtered crash markers, host emulator status and selected receipt booleans. Sanitized
excerpts contain only recognized diagnostic markers; unknown text, paths, secrets, certificates,
packages, memory and screenshots are excluded. Missing, truncated and failed captures are explicit.
The capture helper permits one 2-second device probe, one 5-second liveness command, one 5-second
UID-filtered log read and at most six 2-second reads of exact receipt filenames. Device loss stops
further guest requests. The outer capture limit is 33 seconds, emulator shutdown is 2 seconds,
and finalization is 3 seconds, each with a 1-second forced-kill grace. Including a failed 3-second
checker or receipt operation and its 1-second grace, the hard-bound total is at most 45 seconds.
The existing 420-second instrumentation timeout and test assertions
are unchanged. A diagnostic capsule does not prove which failure caused another or clear release
qualification gates.

Once registered on the default branch, `android-release-candidate.yml` accepts direct Rehearsal
or Candidate dispatch. Candidate is allowed only through that workflow on `main`, not CI or
another caller. It requires exact source and later ledger commits, an unsealed reserved code,
an observed lower Play high-water and the parent's public issue-comment evidence reference.
It does not allocate a code or choose a product version.

These are approved configuration **names**, not evidence that the configuration exists:

| Protected configuration | Purpose |
|---|---|
| Environment `android-release-candidate` | Exact main-only branch policy, required human reviewer, same-owner manual approval permitted and admin bypass disabled. |
| Secret `ANDROID_UPLOAD_KEYSTORE_BASE64` | Owner-custodied upload keystore, not a runner-generated production key. |
| Secret `ANDROID_UPLOAD_STORE_PASSWORD` | Explicit keystore password. |
| Secret `ANDROID_UPLOAD_KEY_ALIAS` | Explicit private-key entry. |
| Secret `ANDROID_UPLOAD_KEY_PASSWORD` | Explicit key password; no fallback to the store password. |
| Variable `ANDROID_UPLOAD_CERT_SHA256` | Approved public upload-certificate fingerprint, independently checked against the actual signer. |

Provisioning, custody/backup/recovery and Play enrollment remain owner-controlled under
[#576](https://github.com/raymond-nassar/recap-page/issues/576). A listed authorized human must manually
approve each run, including their own dispatch. The agent must never approve it.
Preflight rejects absent or weak protection before scheduling the protected job. After approval,
the producer rechecks environment identity/policy and actual approval history. Keep protection
stable through signing: two API snapshots cannot make environment deletion and name-based job
scheduling atomic.

The producer builds clean pinned source with the approved later ledger. It signs the AAB in a
narrow temporary-key step and deletes upload material before native proof. It checks signed
entries, manifest/resources/permissions, embedded source/build records and native-library
inventory. Unexpected native libraries stop qualification pending a separate ABI/16 KB assessment.
Release shrinking stays off, and no runtime dependencies are added.

APK splits come from those exact signed AAB bytes, with an explicitly disposable local signer
and a matching release instrumentation APK. The existing six methods and restart pair run on
that payload. Four selected startup invocations then seed distinct official/prototype state,
replace the official app with the same split bytes, and probe both without reseeding. Installed
APK hashes/certificates, actual instrumentation results and independent pre-replacement state
digests must agree. This is synthetic API-36 payload, restart, same-byte reinstall and coexistence
proof, not a Play-signer upgrade, real-user migration or physical-device acceptance.

The publishing AAB must retain minimum SDK 26 and target SDK 36. For the pinned bundletool
1.18.3 and API-36/x86_64 proof profile, the generated base APK must instead declare exactly
minimum SDK 32 and target SDK 36. If that profile produces base-module configuration APKs,
each must declare minimum SDK 32 with no explicit target SDK. Such configuration APKs must
contain no code, components or permissions and cannot identify themselves as feature splits
or target another module. Their presence in a particular result is established by its inventory,
not assumed from this rule. That tool enables a sparse-resource variant and writes its variant
minimum into all generated splits. Both base-manifest checks use the same fixed context,
bound to the reviewed tool digest and device profile; none accepts an arbitrary higher minimum.
The qualification report's existing scope text records the publishing and tested minima separately.
This does not raise the app's published minimum or establish native behavior on API 26. Changing
the tool or proof profile requires renewed qualification, not an SDK fallback.
See the pinned [variant-minimum implementation](https://github.com/google/bundletool/blob/586a43a450712a1067f3d92cf7574dee68226302/src/main/java/com/android/tools/build/bundletool/splitters/ModuleSplitter.java),
read on 2026-09-30.

Publishing manifests still permit only the original activity. Derived-base inspection additionally
requires exactly one `com.android.vending.splits` metadata entry, whose resource reference must
resolve to `xml/splits0` and the packaged `res/xml/splits0.xml`. The current native source has no
localized resource directories or collision with that generated filename, so its language-mapping
set must be empty. Inspection checks the closed XML structure and the decoded split inventory;
new localization or a source collision requires a reviewed profile update, not an ignored mismatch.
Unknown or duplicate metadata, scalar metadata values, extra executable components and wrong or
dangling resource bindings fail. Conditional tool metadata is not generally exempted. This follows
the pinned [splits-resource generator](https://github.com/google/bundletool/blob/586a43a450712a1067f3d92cf7574dee68226302/src/main/java/com/android/tools/build/bundletool/model/utils/SplitsXmlInjector.java),
read on 2026-09-30.

Network-policy verification reads the same derived APK's compiled resource with pinned build-tools
35.0.0 AAPT2. A strict network-only decoder preserves the supported element and attribute identities,
actual boolean values, child order and character-data records in a DOM, then uses the existing
canonical comparison against the source policy. Missing or changed domain text and flags still fail.
Unknown attributes, elements, namespaces, malformed records and unsupported encodings fail closed.
The older APK Analyzer text view is not authoritative for this resource because it can omit domain
text. Backup and data-extraction XML retain their existing verification path. Reduced diagnostic
summaries never replace canonical verification or supply missing expected hosts or flags.

Only a successful inspection, native proof and cleanup retain the AAB, `android-artifact.json`,
`android-candidate.json` and `version-codes.proposed.json`, for seven days. Save the exact packet
before expiry and review the proposed seal separately. Do not overwrite a newer ledger with that
snapshot. Failed or abandoned candidate codes stay consumed; retries and rebuilds need a new
reservation. See [the exact-artifact contract](RELEASING.md).

Before uploading to Play or promoting a track, reverify the retained bytes, signer and current
sealed ledger. Obtain the required rights, service-use, forms, device and Play approval evidence.
The upload key is not Google's installed app signer. Local proof does not bypass
new-Personal-account closed-testing participation or duration requirements.

## Keep and transfer your progress

Reading data is saved inside the app. Android automatic backup and device-transfer extraction
are disabled for this package. Uninstalling or clearing app data removes that private storage.
Do not rely on an Android device backup to recover it.

Use **Backup & settings** to export JSON, including progress and notes, and restore it on another
device. Restore replaces the destination's reading data; it does not merge or sync.
Settings stay device-specific, as on desktop.

Export opens Android's file picker. Choose a folder **on the device**, such as Downloads, to
keep the file local. Recap Page requests local storage, but document providers control which
locations they offer. Choosing a cloud location can upload the file through that provider.
Recap Page has no upload service of its own.

Export reports success only after Android confirms the write. Do not count a cancelled or failed
picker as a saved recovery copy. If the app closes while the picker is open, reopen it, repeat
the export and check the file before relying on it.

### Future prototype-to-official transfer

This planned transfer does not authorize an official build or installation.
A different application ID has separate private storage, even at the same WebView address.
Nothing copies automatically, and native cross-package transfer has not been verified.

1. Keep the prototype installed. Export JSON to a local folder, check that the file exists and
   is readable, and retain that untouched backup.
2. Only after the release hold is cleared and an official package is approved, install it
   alongside the prototype. If the destination already holds progress, export and check its
   own backup before restoring: restore replaces reading data rather than merging it.
3. Restore deliberately into the official app and compare lists, notes, read markers,
   availability overrides and deferrals. Reapply device-specific settings separately.
4. Keep the old installation and backup until the restored data has been verified. If export,
   restore or verification fails or is uncertain, stop; do not uninstall either app or clear its
   data. The only copy of progress must never depend on an unverified transfer.

## Desktop and Android verification

Run the ordinary repository checks:

```text
npm run lint
npm test
npm run anchors
```

`npm run android:browser` checks generated Android web assets in installed Edge at 360x800,
412x915 and 800x360: type size, touch targets, page overflow, navigation, reading, restart
persistence, export completion/cancellation, themes and dialog Back behavior. Its native-message
transport is a test double, not an Android runtime.

`npm run android:browser -- --only=launcher --viewport=412x915` checks the generated launcher's
empty-result, invalid-identifier and offline explanations, browser escape, safe title rendering
and unchanged reading state. It uses fabricated responses and never opens a real Marvel app.

`npm run android:browser -- --only=mobile-ui` checks reported phone layout defects using the
bundled recommendation, full catalog and Hickman minimal guide. Alongside the three viewport
sizes above, it adds a 1280x900 window and a 360x800 case with 130% text tokens.
It checks recommendation geometry, touch and keyboard focus, parent links, filter scrolling,
list-sheet dismissal and editor handoff. Text-token stress tests browser layout, not Android's
native font scaling. Use `--viewport=360x800` to isolate the normal-text case while iterating.

Install `puppeteer-core` **outside** the repository, as for the existing browser suite.
If it or Edge is outside the usual development locations, set `MRT_PUPPETEER` to its absolute
entry file and `MRT_EDGE` to the browser executable. Optionally set `MRT_ANDROID_SCREENSHOTS`
to an output directory for fixture-only screenshots.

`npm run android:browser -- --only=series-readability` checks series results at 320x740,
360x800, 412x915 and 360x800 with 150% text tokens, plus the shared desktop entry at 1280x900.
It measures word line rectangles, unclipped titles, action hit areas and emergency wrapping on
an unrelated user-content control. Synthetic fixtures check result order, counts and Add behavior
without live API or cover requests. Use `--viewport=320x740` or `--viewport=360x800@1.5` for a
focused pre-fix check. This is desktop Edge CSS text stress, not native fontScale, physical-phone,
TalkBack, keyboard or safe-area certification.

`npm run android:browser -- --only=note-readability` checks ordinary issue-note prose, a
36-character reference and a long URL at 320, 360 and 412 CSS px, both at normal and 150%
text-token sizes, plus the actual desktop entry at 1280x900. On Android it requires every text
rectangle to fit both the note and its nearest clipping ancestor, not just the page width.
It also checks natural word wrapping, exact note strings, unchanged saved state and real backup
payloads using isolated synthetic data with no external requests. Use `--viewport=360x800` for
the focused pre-fix reproduction. This is an Edge layout check,
not native fontScale, TalkBack, IME or physical-device evidence.

`npm run android:browser -- --only=marvel-ages-target` measures the Modern Age browse-all
action at 320, 360 and 412 CSS px with normal and 150% text tokens, plus the actual shared
desktop entry at 1280x900. It requires a 48x48px Android hit area, whole unclipped label words,
unchanged text size and padding, keyboard and touch navigation, and destination focus.
Desktop keeps its 44px height and horizontal heading layout. Use `--viewport=360x800`
for the focused pre-fix reproduction. The bundled catalog and isolated state run without
live API or cover requests; text-token stress is not native Android fontScale or device proof.

`npm run android:browser -- --only=catalog-cards` checks the real catalog renderer in generated
Android assets and the shared desktop entry. Its fixed 16-case matrix covers 320/360/412px,
both themes, 150/200% text-token stress, landscape and desktop, plus 700/701px boundary
measurements. It measures full-width prose, timeline markers, complete credits and gap text,
meaningful accessibility order, Preview/Add and filter/sort compatibility. Cover geometry uses
an original local test image, never publisher artwork. Use `--case=M02` for one case;
`MRT_CATALOG_EVIDENCE` stores measurements. Existing decorative accessibility exposure
([#638](https://github.com/raymond-nassar/recap-page/issues/638)) is retained rather than
presented as a clean accessibility result. These are Edge web checks,
not physical Android, native fontScale or TalkBack acceptance.

## Native emulator checks without a local emulator

The optional **android_emulator** input in **CI** is off by default. It runs the APK in a full
Android 16/API-36 x86_64 phone image on a GitHub-hosted Ubuntu runner. Use this supported pre-phone
path on a Windows ARM computer. It does not install a local emulator or change ordinary push and
pull-request checks.

After pushing a feature branch containing the Android tests, dispatch it explicitly:

```text
gh workflow run CI --ref YOUR_BRANCH -f android_emulator=true
```

The job runs six native scenarios and a separate seed/force-stop/restart probe. First, it changes
only the native connection marker in a temporary build and requires the targeted save test to
fail. It restores the source before running the real suite. Missing or skipped tests, incomplete
runs and failures cannot pass.

The emulator uses real WebView and DocumentsUI for app and picker interactions. External traffic
is blocked; fabricated reading state and an in-device loopback fixture supply data. A test-only
provider checks exact-byte restore and write refusal. Reader destinations are checked through
intercepted Android intents without signing into Marvel or rendering comics.
These test doubles keep the production navigation policy and native message port. The reader
test uses the real popup client, substituting only its fixed synthetic Bifrost response.

Tap proof keeps real touchscreen injection and trusted pointer/click, target/focus and
no-context-menu checks. A temporary non-consuming public touch listener measures DOWN/UP
delivery to the WebView with monotonic uptime, separately from preparation and injection-call
time. The platform long-press threshold is unchanged; missing, cancelled, duplicate or non-touch
delivery cannot count as a short gesture. The listener is removed on every exit. This measures
delivered automated input, not physical-finger duration, and still needs native execution.
See [the public listener contract](https://developer.android.com/reference/android/view/View.OnTouchListener),
read on 2026-09-30.

The reader scenario registers test-only browser and domain-handler activities. On the isolated
emulator, it temporarily makes Chrome the default browser and approves the synthetic handler for
the reader domain. It then checks that browser escape offers both browsers and opens the selected
package. Teardown restores browser-role and domain settings, even after a failed assertion.
These fixture activities are absent from the app APK.

The job keeps test results, synthetic screenshots and emulator/WebView versions in a seven-day
Actions artifact. An installable APK is included only after all positive checks pass, never the
deliberately broken negative-control build. Source and synthetic evidence go to this repository's
GitHub runner, not your saved reading data. This is test infrastructure, not an app cloud service.
Update the pinned emulator/image versions in `scripts/android-emulator-ci.sh` deliberately.

AndroidX dependencies are confined to the separate test APK. They are not shipped in the app.
Emulator results do not complete the physical-device checklist below.

### Observed emulator result

The historical result below predates the DRN app-link integration. It does not establish the
new package-scoped handoff or browser-selection behavior; those require a fresh native run and
physical-device acceptance.

The [2026-09-26 post-review native CI run](https://github.com/raymond-nassar/recap-page/actions/runs/36278075103)
passed on source revision `1ac382df149a52172fd53558ebf113492323a407`.
It used Android 16/API 36, the full Google APIs x86_64 image revision 7, Android Emulator 37.1.11,
and the image's bundled WebView 133.0.6943.137. This is not a claim about the newest WebView or the
Pixel 10 Pro's installed software.

| Native scenario | Observed result |
|---|---|
| Startup and local progress | Bundled app/catalog loaded offline; synthetic list, read marker and note survived reload. |
| Real system picker | DocumentsUI saved a JSON backup; cancellation created no file or progress change. |
| Provider round trip and refusal | The real native bridge preserved 1,584 UTF-8 bytes, restored the fixture through the WebView file callback, and reported an injected write refusal without damaging it. A separate 2,097,164-byte export also passed exact-byte read-back. |
| Reader popup | A real touch opened the local launcher, its opener was null, the bridge asset was refused, and the expected official URL reached an intercepted Android intent. No external reader page was rendered. |
| Back and recreation | Back cancelled the dialog, closed navigation and returned through history; Activity recreation retained the view, list context and progress. |
| Fonts, rotation and keyboard | Normal and 130% text, portrait/landscape and an open keyboard kept measured controls at least 48 CSS pixels and produced no horizontal page overflow. |

All six methods passed with no skips. A separate seed, host force-stop and restart probe also
passed without clearing app data. Deliberately breaking only the native connection marker failed
the intended save-completion assertion before the unmodified suite ran. The ordinary Node 20
and Node 24 jobs each passed 2,223 tests, alongside lint and repository gates.

Independent review corrections isolate Android 13 Back types from the Activity loaded on older
versions and close failed message ports before another export can use them. The larger export
probe exercises the actual WebView message path; it does not establish a universal device capacity.

The exact emulator-tested debug APK has SHA-256
`50e26ac8e72679296a4571730da2dee23904fd8950059d82b9b3e0bc862fcb5e`.
Actions debug signing is disposable and differs from local debug signing. Export a backup before
switching installation sources; Android may require uninstalling a differently signed prototype.
Large-export capacity, process death while a picker is open, other Android versions and physical
Pixel/Marvel subscription behavior are not established by this run.

## Required real-device acceptance

Record the phone model, Android/API version, Android System WebView package/version, app build,
and results. The intended owner test device is a Pixel 10 Pro. These checks remain pending until
somebody performs them on a physical device:

- [ ] Install, cold-start offline, browse bundled lists and retain progress after fully closing
  and reopening the app.
- [ ] Add a list, mark and defer issues, edit notes, search/add comics, change availability
  overrides, and confirm all existing actions remain reachable.
- [ ] Open a known reader link and one needing metadata lookup. Confirm separate launches,
  no opener access to the tracker, one on-demand app-identifier lookup, visible lookup/launch
  failures, and no remote document rendered inside the app's WebViews.
- [ ] With a real subscription, confirm the correct comic opens and returning to Recap Page
  keeps the current reading place. Check **Open in browser** from the retained launcher, including
  after an app loading error; confirm a browser, not Marvel Unlimited, receives that action.
  Record browser and Marvel-app handling separately.
- [ ] With Marvel Unlimited absent or disabled, confirm a visible failure and working browser
  escape. Do not uninstall an app holding important data merely for this check.
- [ ] Save JSON, personal Markdown, order-only Markdown and an unreadable-data copy; inspect
  the files. Cancel a picker and exercise a failed write. Neither may be reported as saved.
- [ ] Restore valid JSON, refuse oversized/invalid JSON, and use Undo last restore. Check that
  cancellation and failed recovery exports never authorize discarding the only unreadable copy.
- [ ] Rotate, background, and terminate the process while a picker is open. Reopen and confirm
  progress survives and an interrupted picker does not claim success.
- [ ] Back cancels a dialog, closes navigation, follows reading history, then leaves the app.
- [ ] Check portrait and landscape, light and dark themes, larger system fonts, display cutouts,
  gesture and three-button navigation, and fields near the bottom with the keyboard open.
- [ ] Recheck the Galaxy S26 reports: focused Home starting choices, compact parent links,
  no heading rectangle after touch navigation, scrollable filters, and List options with working
  editors, exports, cancellation and Back.
- [ ] Confirm the installed package's backup/transfer exclusions and document-provider behavior.

Do not mark this checklist complete using resized-browser screenshots or a successful build alone.
