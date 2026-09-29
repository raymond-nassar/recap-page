# Android prototype

This is an experimental, sideloadable version of Recap Page, not a Google Play release.
It reuses the existing app and reading lists, with larger text and touch targets. There is
no account, synchronization service, new reading feature, or change to the saved-data format.
The supported desktop installation and Windows release process are unchanged.

For volunteer testers, share [the short Android beta checklist](ANDROID_BETA.md). It needs no
development tools and separates ordinary reading checks from optional throwaway-data restore tests.

For maintainers, [Google Play asset previews](GOOGLE_PLAY_ASSETS.md) documents original artwork and
fictional, cover-free phone layouts. Desktop-rendered previews are not native device acceptance
or an approved Play listing.

**Android viability is not yet confirmed on a physical device.** Building an APK and checking
its web screens in a desktop browser do not prove Android file pickers, background recovery,
or Marvel Unlimited reader compatibility. Complete the device checks below before distributing it.

## How it works

The optional project under `packaging/android` bundles the current `src` files at build time,
rather than maintaining another copy of the app. Android-only CSS and an entry module are added
to generated assets. Shared feature fixes therefore reach both versions.

Android's WebView loads those assets at `http://127.0.0.1:8787/` inside the app. There is no Node
server, listening port, remote app host, or computer that must stay on. This address belongs to
the app's private WebView storage; it is **not** the desktop browser's storage or Android Chrome's
storage, even though the address is the same.

Lists, notes, availability overrides and reading progress keep their existing behavior.
Bundled reading lists work offline. Metadata lookups and opening Marvel's reader still require
an internet connection. The app does not download comics or add offline comic reading.

### Phone navigation and controls

On narrow Android screens, the recommended-start card puts its button below the full-width copy.
The link above a page title goes to its immediate parent, such as **Browse** or **Library**,
instead of repeating the whole breadcrumb trail and current title. Android Back still follows
your navigation history; the parent link goes to the named destination.

On a Reading List, **List options** opens a bottom sheet for renaming, notes, duplication,
exports, metadata and deletion. Export choices expand inside the sheet. Choosing an action
closes the sheet before opening any existing editor or confirmation. **Close**, Android Back,
Escape and tapping outside dismiss the sheet without performing an action.

Filters use a single horizontally scrollable row of compact chips. Swipe the row to reach more
choices; keyboard focus also scrolls its choice into view. The selected chip has an underline
as well as its existing color treatment. Filter meanings, counts and reading-filter history are
unchanged. Touch navigation keeps screen-reader heading focus without drawing a focus rectangle;
keyboard navigation retains visible focus. Wider Android windows retain inline list actions and
the full breadcrumb trail. These changes do not alter the desktop app or saved data.

### Marvel Unlimited app links

**Read** opens the isolated local launcher immediately. With no recorded digital issue ID and
a matching exact Marvel issue page whose metadata lookup was already refused, it opens that
page in a browser without another lookup. Otherwise, if the digital issue ID is missing, the
launcher asks the configured metadata service for it. It then asks Marvel's anonymous
Bifrost legacy resolver for the app's issue identifier and opens only a validated issue link in
the `com.marvel.unlimited` package. The combined lookup has an eight-second timeout; empty,
ambiguous or invalid results and failed requests leave an explanation rather than a guessed link.

The launcher stays open after the app handoff. Return to Recap Page to use **Open in browser**
if Marvel Unlimited shows a loading error or the wrong screen. **Try Marvel Unlimited again**
reuses the validated link without another lookup. Browser escape selects an installed browser,
with a choice when several are available; it does not send the fallback back to an arbitrary
app-link handler. Cancellation, a missing browser or a failed launch leaves the launcher usable.
Choosing the browser while a lookup is pending cancels it and prevents a delayed app launch.

Browser discovery uses a hostless HTTPS query and requests all browser choices. It does not use
the comic's domain, so an approved app-link handler or a default browser cannot hide the other
browser choices. The actual comic URL is attached only to the selected browser's launch.

This does not sign in to Marvel, embed comic pages, or verify what Marvel's app rendered.
Opening the app or issue page is not proof that the comic loaded. The existing manual
**Done, next** action still records progress. Desktop uses the same validated issue-page
fallback without a redundant metadata lookup.

The additional request sends the digital ID and exposes the network address to
`bifrost.marvel.com`; it omits credentials and referrers and uses no-store. Recap Page does not
save the returned identifier or send lists, notes or reading progress. The endpoint is
undocumented: support, coverage and usage limits are not guaranteed. Browser escape remains
available when the service, app or comic cannot be opened. See [the privacy policy](../PRIVACY.md).

The resolver mechanism was discovered through
[Naouak/reading-lists](https://github.com/Naouak/reading-lists/blob/158a6366269966c79fe3a4daeed89cace5edc9fa/backend/library/views/redirects.py),
inspected on 2026-09-28. This implementation is independently authored; no upstream source was
copied or translated. No source-reuse license was found for that repository, and this reference
is discovery credit, not a claim of permission or affiliation. It does not establish terms for
Marvel's service.

## Build and install

**Current release hold:** the owner has approved identity preparation, not a new Android version.
Until the current feature set is finalized, do not bump the version, reserve a release code,
create an APK/AAB, distribute a build or upload/promote a Play candidate. The commands below
describe the existing development workflow, not permission to run it during this hold.
See [the owner decision](https://github.com/raymond-nassar/recap-page/issues/570#issuecomment-5894851669).

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

The Windows wrapper restores its checksum-verified Gradle launcher locally on first use; it
downloads build tooling, not app data. On other hosts, use installed Gradle 9.8.0 or restore the
official wrapper JAR with the checksum recorded in `bootstrap-wrapper.ps1` before using `gradlew`.
The build prepares assets automatically. To prepare them without an Android SDK:

```text
npm run android:prepare
```

The debug APK is produced at
`packaging/android/app/build/outputs/apk/debug/app-debug.apk`. Transfer it to the test phone and install it,
allowing installation from that source when Android asks. Alternatively use `adb install -r`
with the generated APK path and an explicitly selected test device.

This is a debug build, not a production-signed release. Keep the same signing key and application
ID when updating an existing test installation. A different signature cannot update it in place;
**export a backup before uninstalling**. Build outputs, SDK paths and signing keys must stay out
of Git. Prototype downloads are published as Android-only GitHub prereleases, not store uploads.

The published Beta 2 used version name `3.0.1-beta.2` and code `3000002`. New builds follow the
[coordinated release policy](RELEASING.md): local and hosted debug builds are explicitly development
builds, while a distribution candidate needs a source-bound code reservation. About identifies
the product version, platform build and source revision. Quote those values and the APK filename
when reporting a problem. That policy identifies source and platform builds, not a qualified
signer. The approved identity and signing model are recorded below; enrollment is still pending.

Dependabot watches the Android Gradle toolchain separately. When updating Gradle, review both the
distribution checksum and the wrapper checksum/bootstrap version together, then rerun the APK
build, Android lint and policy checks.

## Official identity and signing preparation

[The owner approved separate identities](https://github.com/raymond-nassar/recap-page/issues/576#issuecomment-5895064801)
so a future official installation can coexist with the prototype rather than requiring its
removal before transferring progress.

| Source configuration | Application ID | App label |
|---|---|---|
| Official/default release | `io.github.raymondnassar.recappage` | Recap Page |
| Debug prototype | `io.github.raymondnassar.recappage.prototype` | Recap Page prototype |

The default application ID is the official one; debug adds `.prototype`. The Java namespace
remains `io.github.raymondnassar.recappage.prototype`, as do the existing native tests and their
fixture identities. The unchanged `.MainActivity` declaration resolves against that namespace,
not the installed application ID. The standard debug resource override retains the prototype
label. These are [Android's documented identity rules](https://developer.android.com/build/configure-app-module),
[Activity naming rules](https://developer.android.com/guide/topics/manifest/activity-element#nm)
and [source-set rules](https://developer.android.com/build/build-variants#sourcesets),
retrieved 2026-09-29.

**Release signing is intentionally not configured.** Release retains the Android Gradle plugin's
unsigned, non-debuggable defaults; it does not inherit the debug signer. Ordinary debug signing
is still disposable and does not make differently signed old betas update-compatible. An
official application ID or source-bound candidate record is not signing or publication approval.

The selected model is **Google-managed Play App Signing with a separate upload key**.
Google's app-signing key signs installations delivered through Play. The upload key authenticates
uploads; an APK signed only with it is not an interchangeable update for a Play-signed installation.
For occasional distribution outside Play, Google's guidance permits downloading a Play-signed
universal APK from Play Console or the Play Developer API. Independently building and signing
production updates without Google's output would require a different custody decision and is
not the selected model. See [Play App Signing](https://developer.android.com/studio/publish/app-signing)
and [Google's signing and distribution guidance](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en-CA),
retrieved 2026-09-29.

No key has been created or enrolled by this preparation. Actual enrollment, public certificate
fingerprints, upload-key ownership and backup/recovery, and least-privilege CI access remain
owner-approved work in [the signing issue](https://github.com/raymond-nassar/recap-page/issues/576).
Never put private keys, passwords, identity documents or private Console identifiers in source,
issues, logs or artifacts. The owner's new Personal Play account is awaiting Google identity
verification; account creation does not establish production access or permission to publish.

The identity checks inspect source declarations and resource values only. No SDK-generated
merged manifests/resources, signed package, native launch, side-by-side installation, migration
or physical-device result is claimed. Those checks, production-key update continuity, rejection
of incompatible signatures and invalid version transitions, and release-wide copy review remain
open before relying on an official package. The existing prototype runtime is unchanged,
including its prototype-specific failure wording. The release hold remains in force.

## Keep and transfer your progress

Saved reading data remains inside the app. Android automatic backup and device-transfer
extraction are disabled for this package. Uninstalling it or clearing its app data removes that
private storage. Do not rely on an Android device backup to recover it.

Use **Backup & settings** to export JSON and restore that same format on another device.
Restoring replaces the destination's reading data; it is not a merge or automatic sync.
Settings remain device-specific, as in the desktop app.

Android export opens the system file picker. Choose a location **on the device**, such as
Downloads, to keep the file local. Document providers may offer cloud locations; the app requests
local storage, but Android providers control what they expose. Choosing a cloud location can
upload the file through that provider. Recap Page itself has no upload service.

The app reports completion only after Android confirms a successful write. Cancelling or failing
the picker does not count as downloading a recovery copy. If the app is closed while a picker is
open, repeat the export after reopening and check the resulting file before relying on it.

### Future prototype-to-official transfer

This is a planned migration path, not an instruction to build or install an official app now.
A different application ID has separate private storage even at the same WebView address.
Nothing is copied automatically, and the native cross-package transfer has not yet been verified.

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

The ordinary repository checks still apply:

```text
npm run lint
npm test
npm run anchors
```

`npm run android:browser` exercises the generated Android web assets in installed Edge at
360x800, 412x915 and 800x360. It checks type size, touch targets, page overflow, navigation,
reading, restart persistence, export completion/cancellation, themes and dialog Back behavior.
Its native-message transport is a test double, not an Android runtime.

`npm run android:browser -- --only=launcher --viewport=412x915` checks the generated launcher's
empty-result, invalid-identifier and offline explanations, browser escape, safe title rendering
and unchanged reading state. It uses fabricated responses and never opens a real Marvel app.

`npm run android:browser -- --only=mobile-ui` covers the reported phone layout defects with the
bundled recommendation, full catalog and Hickman minimal guide. It adds a 1280x900 wide window
and a 360x800 case with text tokens enlarged to 130%, alongside the three viewport sizes above.
It checks recommendation geometry, touch versus keyboard focus, parent links, filter scrolling,
list-sheet dismissal and editor handoff. The text-token case is a browser layout stress check,
not a simulation of Android's native font scaling. Use `--viewport=360x800` to isolate that
normal-text case while iterating.

Like the existing browser suite, it uses `puppeteer-core` installed **outside** the repository.
Set `MRT_PUPPETEER` to its absolute entry file and `MRT_EDGE` to the installed browser executable
if they are not in the usual development locations. `MRT_ANDROID_SCREENSHOTS` optionally names
an output directory for fixture-only screenshots.

`npm run android:browser -- --only=series-readability` checks series results at 320x740,
360x800, 412x915 and 360x800 with 150% text tokens, plus the shared desktop entry at 1280x900.
It measures actual word line rectangles, unclipped titles, action hit areas and emergency
wrapping on an unrelated user-content control. Synthetic fixtures check result order, counts
and Add behavior without live API or cover requests. Use `--viewport=320x740` or
`--viewport=360x800@1.5` for an aimed-at pre-fix check. This is desktop Edge CSS text stress,
not native fontScale, physical-phone, TalkBack, keyboard or safe-area certification.

`npm run android:browser -- --only=note-readability` checks ordinary issue-note prose, a
36-character reference and a long URL at 320, 360 and 412 CSS px, both at normal and 150%
text-token sizes, plus the actual desktop entry at 1280x900. On Android it requires every text
rectangle to fit both the note and its nearest clipping ancestor, not just the page width.
It also checks natural word wrapping, exact note strings, unchanged saved state and real
backup payloads with isolated synthetic data and no external requests. Use
`--viewport=360x800` for the focused pre-fix reproduction. This remains an Edge layout check,
not native fontScale, TalkBack, IME or physical-device evidence.

`npm run android:browser -- --only=marvel-ages-target` measures the Modern Age browse-all
action at 320, 360 and 412 CSS px with normal and 150% text tokens, plus the actual shared
desktop entry at 1280x900. It requires a 48x48px Android hit area, whole unclipped label words,
unchanged text size and padding, keyboard and touch navigation, and destination focus.
Desktop keeps its 44px height and horizontal heading layout. Use `--viewport=360x800`
for the focused pre-fix reproduction. The bundled catalog and isolated state run without
live API or cover requests; text-token stress is not native Android fontScale or device proof.

## Native emulator checks without a local emulator

The **CI** workflow has an optional **android_emulator** input, off by default. It runs the APK
inside a full Android 16/API-36 x86_64 phone image on a GitHub-hosted Ubuntu runner. This is the
supported pre-phone path for a Windows ARM computer; it does not install an emulator locally or
change ordinary push and pull-request checks.

After pushing a feature branch containing the Android tests, dispatch it explicitly:

```text
gh workflow run CI --ref YOUR_BRANCH -f android_emulator=true
```

The job runs six native scenarios and a separate seed/force-stop/restart probe. It also changes
only the native connection marker in a temporary build and requires the aimed-at save test to
fail, then restores the source before running the real suite. Missing tests, skipped tests,
incomplete runs and failures cannot produce a passing result.

The emulator uses real WebView and DocumentsUI for app and picker interactions. External network
traffic is blocked; fabricated reading state and an in-device loopback fixture supply test data.
A test-only provider exercises exact-byte restore and write refusal. Reader destinations are
asserted through intercepted Android intents, not by signing into Marvel or rendering comics.
Those deliberate test doubles retain the production navigation policy and native message port.
The reader test forwards through the real popup client while substituting only its fixed
synthetic Bifrost response.

The reader scenario also registers test-only browser and domain-handler activities. On the
isolated emulator it temporarily selects Chrome as the browser default and approves the synthetic
handler for the reader domain, then checks that browser escape still offers both browsers and
opens the selected package. Browser-role and domain settings are restored in teardown, including
after a failing assertion. These fixture activities are absent from the app APK.

The job preserves test results, synthetic screenshots and emulator/WebView versions as a seven-day
Actions artifact. It includes an installable APK only after all positive checks pass, never the
deliberately broken negative-control build. It sends source and synthetic test evidence to this repository's
GitHub runner, never your saved reading data. It is testing infrastructure, not an app cloud service.
The pinned emulator/image versions in `scripts/android-emulator-ci.sh` need deliberate updates.

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
- [ ] Recheck the Galaxy S26 reports: full-width Home recommendation, compact parent links,
  no heading rectangle after touch navigation, scrollable filters, and List options with working
  editors, exports, cancellation and Back.
- [ ] Confirm the installed package's backup/transfer exclusions and document-provider behavior.

Do not mark this checklist complete using resized-browser screenshots or a successful build alone.
