# Android prototype

This is an experimental, sideloadable version of Recap Page, not a Google Play release.
It reuses the existing app and reading lists, with larger text and touch targets. There is
no account, synchronization service, new reading feature, or change to the saved-data format.
The supported desktop installation and Windows release process are unchanged.

For volunteer testers, share [the short Android beta checklist](ANDROID_BETA.md). It needs no
development tools and separates ordinary reading checks from optional throwaway-data restore tests.

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

**Read** keeps the existing local launch page and official Marvel URLs. The Android shell sends
the resulting external URL to a browser or an installed handler chosen by Android. It does not
sign in to Marvel, embed comic pages, or promise that Marvel's Android app will open a particular
issue. The existing manual **Done, next** action still records progress.

## Build and install

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
.\packaging\android\gradlew.bat -p packaging\android assembleDebug lintDebug policyTest
```

The Windows wrapper restores its checksum-verified Gradle launcher locally on first use; it
downloads build tooling, not app data. On other hosts, use installed Gradle 8.13 or restore the
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
of Git. No store upload or public release is part of this prototype.

Dependabot watches the Android Gradle toolchain separately. When updating Gradle, review both the
distribution checksum and the wrapper checksum/bootstrap version together, then rerun the APK
build, Android lint and policy checks.

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

Like the existing browser suite, it uses `puppeteer-core` installed **outside** the repository.
Set `MRT_PUPPETEER` to its absolute entry file and `MRT_EDGE` to the installed browser executable
if they are not in the usual development locations. `MRT_ANDROID_SCREENSHOTS` optionally names
an output directory for fixture-only screenshots.

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
Those deliberate test doubles do not replace the production WebView clients or native message port.

The job preserves test results, synthetic screenshots and emulator/WebView versions as a seven-day
Actions artifact. It includes an installable APK only after all positive checks pass, never the
deliberately broken negative-control build. It sends source and synthetic test evidence to this repository's
GitHub runner, never your saved reading data. It is testing infrastructure, not an app cloud service.
The pinned emulator/image versions in `scripts/android-emulator-ci.sh` need deliberate updates.

AndroidX dependencies are confined to the separate test APK. They are not shipped in the app.
Emulator results do not complete the physical-device checklist below.

### Observed emulator result

The [2026-09-26 native CI run](https://github.com/raymond-nassar/recap-page/actions/runs/36264026495)
passed on source revision `e68b1891cc83da8257a288cf4bcdfb5680ead27c`.
It used Android 16/API 36, the full Google APIs x86_64 image revision 7, Android Emulator 37.1.11,
and the image's bundled WebView 133.0.6943.137. This is not a claim about the newest WebView or the
Pixel 10 Pro's installed software.

| Native scenario | Observed result |
|---|---|
| Startup and local progress | Bundled app/catalog loaded offline; synthetic list, read marker and note survived reload. |
| Real system picker | DocumentsUI saved a JSON backup; cancellation created no file or progress change. |
| Provider round trip and refusal | The real native bridge preserved 1,584 UTF-8 bytes, restored the fixture through the WebView file callback, and reported an injected write refusal without damaging it. |
| Reader popup | A real touch opened the local launcher, its opener was null, the bridge asset was refused, and the expected official URL reached an intercepted Android intent. No external reader page was rendered. |
| Back and recreation | Back cancelled the dialog, closed navigation and returned through history; Activity recreation retained the view, list context and progress. |
| Fonts, rotation and keyboard | Normal and 130% text, portrait/landscape and an open keyboard kept measured controls at least 48 CSS pixels and produced no horizontal page overflow. |

All six methods passed with no skips. A separate seed, host force-stop and restart probe also
passed without clearing app data. Deliberately breaking only the native connection marker failed
the intended save-completion assertion before the unmodified suite ran. The ordinary Node 20
and Node 24 jobs each passed 2,222 tests, alongside lint and repository gates.

The exact emulator-tested debug APK has SHA-256
`7e898eebc3d3c3344db1ce8bdbe31b9a8ee19a0a42a445e309f77fa1917051ce`.
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
  no opener access to the tracker, visible browser-handoff failures, and no remote document
  rendered inside the app's WebViews.
- [ ] With a real subscription, confirm the correct comic opens and returning to Recap Page
  keeps the current reading place. Record browser and Marvel-app handling separately.
- [ ] Save JSON, personal Markdown, order-only Markdown and an unreadable-data copy; inspect
  the files. Cancel a picker and exercise a failed write. Neither may be reported as saved.
- [ ] Restore valid JSON, refuse oversized/invalid JSON, and use Undo last restore. Check that
  cancellation and failed recovery exports never authorize discarding the only unreadable copy.
- [ ] Rotate, background, and terminate the process while a picker is open. Reopen and confirm
  progress survives and an interrupted picker does not claim success.
- [ ] Back cancels a dialog, closes navigation, follows reading history, then leaves the app.
- [ ] Check portrait and landscape, light and dark themes, larger system fonts, display cutouts,
  gesture and three-button navigation, and fields near the bottom with the keyboard open.
- [ ] Confirm the installed package's backup/transfer exclusions and document-provider behavior.

Do not mark this checklist complete using resized-browser screenshots or a successful build alone.
