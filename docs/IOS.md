# iOS app

Recap Page for iPhone and iPad is in development under
[#949](https://github.com/raymond-nassar/recap-page/issues/949). It is not on TestFlight or the App
Store yet. Like the [Android app](ANDROID.md), it is the existing web app inside a small native
shell, so every fix to the shared app reaches iOS too, and it adds no account, server or upload.

**Nothing here is in anyone's hands yet.** The shell is built and tested in the iOS Simulator on
GitHub's macOS runners for every pull request. Saving files through the Files picker, Read, text
size and signed builds for TestFlight arrive in later steps of #949, each with its own checks.

## How it works

`npm run ios:prepare` writes the bundled web app into `packaging/ios/build/generated/web`, which is
ignored rather than committed. It copies the current `src` files, leaving out the same five the
Android app leaves out: the fault harness, the service worker and the browser entry that registers
it. It adds the Android app's phone layer as `mobile/`, the iOS entry and overlay stylesheet as
`ios/`, a configuration with the page origin and security headers, the build identity that About
shows, and a manifest listing every file with its SHA-256.

The native shell in `packaging/ios` is a UIKit app with one web view. A scheme handler answers every
request for the app's own scheme from those bundled files, and only for paths the manifest lists. Its
headers are the Windows app's server's, with `frame-src 'none'` and `worker-src 'none'` added to the
content security policy, as the Android app serves it. There is no listening server and nothing to
keep running.

Only the app page loads in the web view. A link you follow to the web, such as the privacy policy or
a source credit, opens in your default browser, and any other navigation is refused. If iOS ends the
page's process, which it can do to an app in the background, the app reloads the page and says that
saved reading progress is retained: saved data lives outside that process.

## Permanent names

These four names come from `packaging/ios/identity.json`, and a repository test fails if any copy of
them in the project, the property list, the preparation script or the shell disagrees.

| Name | Value | Why it can never change |
|---|---|---|
| Bundle identifier | `io.github.raymondnassar.recappage` | It is the app's identity on the device and in App Store Connect, and the Android app's official id. |
| iCloud container | `iCloud.io.github.raymondnassar.recappage` | Optional iCloud backup will live in it, and a container can never be deleted or renamed. |
| Name on the Home Screen | Recap Page | It is how people find the app. |
| Page origin | `recappage://localhost` | Every saved byte of reading data is stored under it. |

The Windows and Android apps keep the address `http://127.0.0.1:8787`, unchanged. iOS cannot serve
an app's own pages over http or https, so the iOS app needs an address of its own, and it is fixed
for the same reason the port is: a different address is a different storage area, and saved progress
would look missing. The host is `localhost` because WebKit's tracking prevention, which deletes a
site's stored data in Safari after seven days without interaction, does not apply to that host
outside Safari.

## Building and verifying

No Mac is needed. The iOS workflow runs on every pull request and on every push to main. It prepares
the assets, builds the app for the Simulator, and runs the unit and UI tests on the newest iOS
runtime GitHub's macOS image carries and on the lowest iOS 18 runtime available, because the app
supports iOS and iPadOS 18.0 and later. Its result bundles are kept as run artifacts. The check is
advisory: the owner decides when it becomes required.

The tests prove, on both runtimes:

- the scheme handler serves every listed file whole, with its type and the shared headers, and
  refuses everything else;
- the navigation rules load only the app page and send followed web links out;
- the page runs at `recappage://localhost` as a secure context, with Web Locks, `crypto.randomUUID`,
  durable IndexedDB transactions and same-origin modules, and the content security policy refuses
  inline script;
- a value saved before the app ends is there when it opens again;
- Home and a reading list's Preview open with every request to the internet blocked;
- an ended page process reloads and the reader is told nothing saved was lost;
- how much saved data fits, as described under [Storage capacity](#storage-capacity).

The tests block every http and https request, so a test run never contacts a third party. That
blocking, and the probe interface the UI tests read results through, exist only in Debug builds. A
repository test reads every Swift file in the app's folder and fails if any of it, any use of it, or
any call that reaches a method by its name, which is how WebKit's private test hooks are reached,
could reach a Release build.

On a Mac, run `npm run ios:prepare` and open `packaging/ios/RecapPage.xcodeproj` in Xcode 26.

## Storage capacity

WebKit gives each origin 5 MiB of storage for saved reading data, and charges a stored string by the
form the engine holds it in: one byte per character for a string held in its one-byte form, two for one
held in its two-byte form. On iOS the app's saved reading data is held in the two-byte form even when
every character is Latin-1, so it costs two bytes per character either way. Restoring a reading-data
backup briefly holds up to three copies: the saved data, the restore's staged copy and the copy kept
for Undo.

The capacity probe in `packaging/ios/probes/capacity.js` measures this through the app's own storage
and restore code. It fills the app with reading lists from the bundled files until a complete backup
is the size of the owner's, 1,183 KB, then saves, restores into an empty app, restores into the app
that already holds data, and restores once more. It does this twice, once with text above Latin-1 and
once without. Each run also records the page's origin, whether WebKit agrees, when asked, to keep the
app's data, and the width WebKit charges for the saved data.

Measured on the iOS 26.5 and iOS 18.5 Simulators, with the same result on both, at that size:

| Step | Text above Latin-1 | Latin-1 only |
|---|---|---|
| Saving | Fits | Fits |
| Restoring into an empty app | Fits | Fits |
| Restoring into an app that holds data | Refused | Refused |
| Restoring again | Refused | Refused |

A refused restore changes nothing and says so. At two bytes per character, three copies of reading
data the owner's size come to about 7.5 MB and two to about 5.0 MB, against 5.24 MB, which is why only
the restore into an empty app fits. Until reading data is stored at one byte per character (#960), a
restore of data this size on iOS has to go into an empty app: export, erase, then restore. Playwright's
WebKit build on Windows, measured first as a stand-in, holds Latin-1 data in its one-byte form, so it
refused only the restore with text above Latin-1. The measurements are recorded on #949.

## Known limits

- Saving backups and exports to Files, choosing a backup file to restore, Read, text size, iPad
  window sizes and a notice when iOS removes saved data are not in the app yet.
- iOS can remove an app's website data when the device runs short of space, and this app cannot opt
  out of that. Keep a backup outside the app.
- iPhone and iPad device backups, to iCloud or to a computer, include this app's saved data. The
  app's privacy text says so.
- Checks that need a real device, such as Read handing a comic to a browser, run on the owner's iPad
  with iOS 18; checks that need an iPhone stay unverified until one is available.

## Signing and internal TestFlight

The manual **iOS TestFlight** workflow is tooling, not a delivered build. It has not yet proved
cloud signing, Apple processing, installation or an update on a device. Nothing here changes saved
reading data. It cannot be dispatched until its workflow is on main. Merge the native-feature
work first, then this tooling, then reserve builds against the intended source already on main.

### Owner setup, in order, from Windows

Do these steps yourself in the Apple and GitHub websites. Never put a private key, certificate,
team identifier, key identifier or issuer identifier in a repository file, Issue, pull request or
chat. The permanent app names above are public app configuration, not account identifiers.

1. Wait for Apple to confirm the Developer Program membership is active. In Certificates,
   Identifiers & Profiles, register an explicit App ID using the permanent bundle identifier
   above. Enable iCloud and register and associate the permanent container above; CloudKit schema
   setup belongs to the later iCloud phase, not this first TestFlight build.
2. In App Store Connect, create an iOS app record called **Recap Page**, selecting that App ID.
   Choose the primary language and your own private SKU. Do not copy the SKU into the repository.
3. In the app's TestFlight tab, create an **internal** testing group for yourself. Keep automatic
   distribution off so you choose when a processed build reaches the group. No external group,
   public invitation link or App Store submission is part of this phase.
4. In Users and Access, Integrations, request App Store Connect API access if needed. Create a
   **team API key with Admin access**, needed for cloud-managed signing. An individual key is not
   assumed to support this route. Download the private key once and keep it in secure local
   custody. Team keys can affect all apps on the team; revoke it promptly if compromised. Never
   paste it into a chat. No account password or two-factor code is needed by the workflow.
5. In this repository's Settings, Environments, create **ios-testflight** yourself. Require
   **raymond-nassar**, and nobody else, as its reviewer. Turn off administrator bypass. Leave
   prevention of self-review off so you can approve a run you started. Set deployment branches
   and tags to selected branches only: one **branch** rule, exactly **main**, with no tag rule.
   The workflow checks these settings before it enters the environment and again after approval;
   a missing or unreadable protection setting stops the run, rather than creating an environment.
6. Add these **environment secrets**, never repository or organization secrets: **ASC_PRIVATE_KEY**
   (the complete downloaded key text), **ASC_KEY_ID**, **ASC_ISSUER_ID**, and **APPLE_TEAM_ID**.
   Read the last three directly from your Apple account. Do not send them to an agent. The key
   text is written only to a private runner-temporary file, removed in an always-run step, and
   excluded from retained artifacts.

### Each build: reserve, export, seal, upload

Follow the [iOS exact-artifact contract](RELEASING.md#ios-allocation-and-exact-artifact-contract).
Reserve a fresh number through a pull request, merge it, then start **iOS TestFlight** on **main**
in **export** mode with that number. Review and approve the environment deployment yourself.
This first approval allows cloud signing and export, **not upload**.

The run uses Xcode 26.3 on macOS 15, matching the toolchain whose Simulator build is tested on
iOS 18 by the minimum job. It archives the pinned source in Release and exports a signed IPA to
disk with destination **export**, never destination upload. The artifact contains the IPA, its
public-safe record and a proposed ledger seal. Artifacts last **30 days**; complete the seal and
upload before they expire, or preserve the exact packet securely before expiry. Expired artifacts
cannot be rebuilt with the same number.

Review the proposed seal and merge only the matching entry's artifact fields into the latest
ledger, preserving later reservations. Start a **new** workflow run in **upload** mode with the
same build number and the successful export run ID. Review and approve that deployment separately.
It fetches that run's packet and checks its name, size, hash and source against the current merged
seal before invoking Apple's altool. No signing or rebuilding happens during upload.

Never rerun either mode or dispatch it twice for the same number. Even failed or uncertain
attempts block another attempt in that mode. Investigate Apple processing before deciding what
happened; a failed export consumes its number, and a failed or uncertain upload is not retried
automatically. Use a fresh reservation for a new build. Upload in allocation order and check
App Store Connect before approving, especially after an uncertain result.

After Apple finishes processing, resolve any compliance questions yourself, add the build to
your internal group, and install it through TestFlight on the iPad. A successful upload is not
proof that processing, installation, offline start or saved-data-preserving updates work. Record
the two-build update and recovery checks on #949, and leave iPhone-only checks pending if there
is no iPhone available.

### Renewal and fallbacks

TestFlight builds expire after **90 days** and then stop opening. The upload receipt records the
upload time and an estimated expiry of upload plus 90 days; confirm the actual expiration shown
by TestFlight after processing. Before that date, reserve, export, seal and separately approve
the upload of a new build. A newer build is intended to update in place without losing reading
progress; that remains a device acceptance check until the first two builds prove it. Keep an
exported backup outside the app. Renew the Developer Program membership **yearly** and keep the
API key's access and the environment's protection under review.

If cloud signing fails, stop and retain the failed number as consumed. The fallback is an Apple
Distribution certificate and matching App Store provisioning profile: generate a private key and
certificate signing request locally on Windows with OpenSSL, submit only the signing request in
Apple's Certificates portal, download the issued certificate, and export a password-protected
PKCS#12 locally. Create a distribution profile for this App ID and certificate in the portal.
Keep all signing material outside the repository. This fallback is documented, **not implemented
or tested**: it needs a reviewed workflow change to import the certificate into a temporary
keychain, install the profile, sign, and always remove both. Do not place certificate material in
the API-key secret or bypass the approval/seal sequence to get past a signing failure.

If altool is unavailable or fails, stop, inspect the outcome and obtain a fresh owner decision
before an upload attempt. Apple's Transporter command line and the App Store Connect Build
Upload API are supported alternatives, but not automatic retries. They must use the same verified
sealed IPA with separate approval, never rebuild or re-sign it.

Official references, retrieved 2026-10-29:
[cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/),
[API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/),
[upload methods and Xcode requirements](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/),
and [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).
