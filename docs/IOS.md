# iOS app

Recap Page for iPhone and iPad is in development under
[#949](https://github.com/raymond-nassar/recap-page/issues/949). It is not on TestFlight or the App
Store yet. Like the [Android app](ANDROID.md), it is the existing web app inside a small native
shell, so every fix to the shared app reaches iOS too, and it adds no account, server or upload.

**Nothing here is in anyone's hands yet.** The shell is built and tested in the iOS Simulator on
GitHub's macOS runners for every pull request. Files export and restore, Read, text size, iPad
windowing and the missing-data notice are being implemented and tested in P02 of #949. Signed
builds for TestFlight follow in P03, with their own checks.

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

## Text size and windowing

The native shell maps the system text size to the six shared type tokens. It does not zoom the page
or enlarge layout dimensions. At the largest accessibility text size, the iOS overlay gives the Home
header one column so the What's new control keeps enough width to read. This adjustment is confined
to the iOS bundle; the shared Windows and Android styles do not change. The iOS skip link uses the
shared `--target` token for a 44-point hit region, and the standalone Read links use the shared
`--target-touch` token for 48-point regions. The native shell gives each link its accessible name
and hides its presentation-only text wrapper from assistive technology, so the link target is not
represented by a smaller nested text element. At the largest accessibility text size, the Backup &
settings section headings can wrap within their existing column rather than widening the page.

The Simulator presentation tests cover both default and largest text sizes, light and dark
appearances, iPhone and iPad windows, and the Read sheet. Hosted validation of the current
presentation corrections is in progress. VoiceOver, hardware keyboard, pointer, actual Files picker
and browser hand-off behavior still need the owner's device checks.

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

- Files export and restore, Read hand-off, Dynamic Type, iPad window sizing and the missing-data
  notice are implemented and under hosted Simulator validation. Actual Files picker, browser
  hand-off and assistive-technology behavior remain device checks.
- iOS can remove an app's website data when the device runs very low on space, and this app cannot
  opt out of that. The About text recommends keeping an export outside the app, explains that it can
  include progress and notes, and says that deleting the app does not remove exported files.
- iPhone and iPad device backups, to iCloud or to a computer, include this app's saved data. The
  app's privacy text says so.
- Checks that need a real device, such as Read handing a comic to a browser, run on the owner's iPad
  with iOS 18; checks that need an iPhone stay unverified until one is available.
