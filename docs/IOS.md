# iOS app

Recap Page for iPhone and iPad is in development under
[#949](https://github.com/raymond-nassar/recap-page/issues/949). Build 4 (4.2.0) is in internal
TestFlight and has been installed on the owner's iPad since October 29, 2026. It is not on the App
Store. Build 5 is the planned first external TestFlight build. Like the
[Android app](ANDROID.md), it is the existing web app inside a small native shell, so every fix to
the shared app reaches iOS too, and it adds no account, server or upload.

The shell is built and tested in the iOS Simulator on
GitHub's macOS runners for every pull request. Files export and restore, Read, text size, iPad
windowing and the missing-data notice are under automated validation. The installed build starts
offline and keeps progress across relaunch, as recorded on #949. Update-in-place and the remaining
device checks wait for build 5 and later steps of #949.

On the minimum runtime, the launch and presentation classes run separately from the same
nonempty `.xctestrun` produced by one build. The matching iPhone SE presentation invocation
reuses that runtime's build too. Each invocation keeps its own result bundle and proof attachments.

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

Only the app page loads in the web view. Read and other web links are handed to iOS to open outside
Recap Page. Depending on the link and your device settings, iOS may open your browser or an installed
app, such as Marvel Unlimited. Recap Page does not choose which app receives the link or confirm that
it opens the right comic. Other navigation inside the web view is refused.

If iOS ends the page's process, which it can do to an app in the background, the app reloads the page and says that
saved reading progress is retained: saved data lives outside that process.

## Text size and windowing

The native audit separately classifies a StaticText hit-area finding when its entire native crop
is behind the fixed bottom navigation, and every condition below must hold in the same run. The
DOM navigation rectangle is converted into native coordinates, and the crop must fit inside it and
inside its unique content owner without tolerance. Every text-fragment sample must hit the sidebar
subtree and none may hit the owner. No native control of any type may contain the crop under the
same label. The owner must pass the same static proof as the passive guard: a valid page-wide
inventory, no interactive element, label association or handler on it or its ancestors, and only
hidden ARIA-linked controls absent from the native tree. It must also be reachable: no fixed or
sticky ancestor, no clipping scroll container, a height no taller than the space above the bar,
and enough remaining document scroll to lift its bottom above the bar's top. Any sidebar text or
`aria-label` with the same label whose frame intersects the crop makes it a navigation finding,
which never qualifies. Settled route, DOM and geometry must agree, route, DOM digest and scroll
position must be unchanged afterwards, and each classification or rejection records the crop,
navigation frame, hit targets and reachability arithmetic. Live negatives for an interactive
owner, a label-linked owner, a fixed unreachable owner and a navigation finding run on the
iPhones, each also seen accepted with its own check disabled; iPad has no bottom bar and skips
them. Where the native tree exposes the label-linked text as part of a control, as on the
iOS 18 iPhone SE at fd75442b, the control exclusion rejects it first and only the newest runtime
shows its passivity check disabled. The minimum-iPhone screenshot and Range samples in run 41138429203 established that its
cropped Reading data heading was behind the bar, not visible text. Run 41163429277 confirmed the
classification: crop `(29,766,332,10)` inside the live navigation frame `(0,753,390,91)`, with all
three samples hitting Library navigation and none hitting the owner.

The native shell maps the system text size to the six shared type tokens. It does not zoom the page
or enlarge layout dimensions. At the largest accessibility text size, the iOS overlay gives the Home
header one column so the What's new control keeps enough width to read. This adjustment is confined
to the iOS bundle; the shared Windows and Android styles do not change. The iOS skip link uses the
shared `--target` token for a 44-point hit region, and the standalone Read links use the shared
`--target-touch` token for 48-point regions. The native shell gives each link its accessible name
and hides its presentation-only text wrapper from assistive technology, so the link target is not
represented by a smaller nested text element. This also covers the two first-run Home links,
Start with Modern Timeline and Search, including when Home inserts them after the page loads. The empty-Home
native scenario checks both links' names, target sizes and destinations independently of the
populated audit fixture. At the largest accessibility text size, the Backup &
settings section headings can wrap within their existing column rather than widening the page.
At that text size, the iOS Theme selector also permits its selected text to wrap. On the 375-point
iPhone SE Simulator, WebKit otherwise let the native selector's single-line text overflow its
correctly sized field. Edge contained the same field on both platform bundles. This iOS-only
adjustment keeps the shared field dimensions and tokens and does not change Windows or Android.

The presentation audit uses a fail-closed passive-text guard, approved in #1005, not a blanket
exemption for text. Ten previously reviewed cases remain positive fixtures: the iPad sidebar's
`h2#rail-reading` ("READING") inside the Main navigation,
its App heading (`#sidebar-nav > .nav-foot > h2.rail-h`), Home's `#chero-count > b.glance-n` read count,
the direct "of 0 issues" text and `.glance-end` "read" suffix in that count, the empty-list
`#chero-next` caption inside the named Continue region, and the `#home-yours > .sec-h > .sec-note`
summary inside Your Reading Lists. That summary is beside the list, not inside a tile link.
The three further cases are Library's `#library-yours .sec-note` summary in Your Reading Lists,
its `#library-rated-shelf-status` empty caption in Top-rated comics, and the current-page
breadcrumb span (`.breadcrumb [aria-current=page]`) inside Breadcrumb navigation. The breadcrumb
case uses the fixed Library, Search or Backup & settings label for the active audited page;
breadcrumb links are controls, not passive candidates.
Only a hit-region finding on native StaticText can enter the guard. On the current settled route,
the native label, container and frame must uniquely match a visible DOM text node. An exact
DOM-hit-tested text point must lie inside the native frame, including a cropped text frame,
not a gap inside a multiline span's bounding box. The test taps that absolute native coordinate;
it does not ask XCTest to resolve an element-relative point from a different underlying frame.
Candidate geometry must agree before and after the tap. Hidden, inert,
collapsed, stale, unmatched or ambiguous text fails. The node, its in-page ancestors and descendants
must have no interactive element or role, tabindex, label association, editable content or click,
double-click, auxiliary-click, context-menu, mouse, pointer, touch or key handler. Tracking starts
before the document's scripts run and includes registered and inline handlers.
The containing box is the passive text's owning element, since iOS can crop a multiline text
finding to the full block width even when a direct text range is narrower. The tap must still
hit an actual fragment of that exact text inside the native crop; the containing box alone
cannot justify acceptance.
The same center, top-inset and bottom-inset points are hit-tested individually before admitting
a fragment. A covered center does not discard a visible top or bottom point; a fully covered
fragment still fails.

Only containment of the native frame in that DOM owner box permits up to two native points
on each edge. In [run 41111198714](https://github.com/raymond-nassar/recap-page/actions/runs/41111198714),
SE's largest-text count had native frame `(29,336,41,78)` against DOM owner and text Range
`(29,316.453125,40.55377197265625,76)`, with WebView origin `(0,20)`. Its native bottom
extended 1.546875 points beyond the owner. The computed font and line height were 62.35294px;
Canvas font ascent 60 plus descent 16 also equaled 76. The native height of 78 is unexplained,
not established as rounding. Fixtures accept this measured case and reject just over two points
on every edge. Strict expected failures exercise only deliberate one-point and oversized
fixture bounds, never a live audit. Assertion continuation is enabled only in that fixture
block and restored before launching the app, so the first expected failure cannot skip the
remaining boundaries or structural negatives. Text-fragment tap points, native/WebView containment,
unique identity, passivity and the complete native no-op remain unchanged. A missing candidate,
such as the separate minimum-iPhone "Reading data" finding, cannot use this allowance.

The positive-fixture driver reveals each offscreen target before requesting that same strict
proof. On narrow windows it also leaves 44 points above the bottom navigation's More target:
a DOM-hit-tested passive-text tap near that navigation has navigated to Search natively on SE,
and correctly failed the no-op proof. The guard itself still rejects an offscreen finding;
scrolling is preparation for a fixture tap, not an audit exemption. Unmatched-text diagnostics
record actual Range fragments and sampled DOM hit targets; those observations do not grant
acceptance.

ARIA references from a control still reject text unless every referencing control is absent
from rendering and accessibility on that settled route. The control or an ancestor must be
hidden or `display:none`, have no client rectangles and be unable to take focus. The test also
requires an identifiable control with no matching identifier or name in the native accessibility
tree, before and after the tap. A visually hidden but exposed input still rejects the text.
This exception applies only to `aria-describedby` and `aria-labelledby`. A nested label or
`for` association always rejects text, even when its checkbox or input is hidden. The mandatory
native no-op tap and every other guard condition remain unchanged.

Document and window are checked separately against an exact reviewed inventory of thirteen handlers,
all on document and none on window. The inventory pins event type, target, capture, passive and once
options, script URL and enclosing registering function, not line or column. It contains rated-comics'
capture pointerdown, keydown and touchmove handlers; mobile-ui's capture pointerdown and keydown;
home-updates' capture keydown and bubbling pointerdown; tooltips' capture keydown and bubbling
pointerover, pointerout and pointermove; and the sidebar and reading shortcuts' bubbling keydown
handlers. No global activation delegation is permitted. An unreviewed global registration or changed
inventory rejects every candidate until reviewed. The keyboard handlers do not make a non-focusable
text node a key target. The pointer and tooltip handlers still have to survive the native tap proof.
Interaction on-properties on document and window are tracked from document start too. Assigning
a click, double-click, auxiliary-click, context-menu, mouse, pointer, touch or key handler makes
the inventory invalid for the rest of that page, even after removal or restoration of its prior
value. Removal is not human review. Tracking delegates to the original native getters and setters
so handler identity, event delivery and removal retain their behavior. A fixture assigns
`document.onclick`, restores its prior value and requires every candidate to remain rejected.

WebKit's public iOS accessibility wrapper handles
[accessibility hit testing separately from activation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/accessibility/ios/WebAccessibilityObjectWrapperIOS.mm):
an unignored text object can be returned by hit testing even when activation has no action.
This source was inspected on October 29, 2026; Apple's internal audit-selection logic is not
observable here. Every candidate must survive a real native no-op tap with route, focus and DOM
unchanged, using fresh before-and-after samples. A tooltip appearing or any other DOM change rejects
the node. All other elements and audit types still fail. The ten original positive cases passed on
the newest iPhone, iPad and iPhone SE at default text before this general guard; the guard itself
still requires hosted confirmation. Negative fixtures cover link and button text, own and ancestor
handlers, hidden content, ambiguous duplicate text, unreviewed globals and DOM-changing pointer or
tooltip taps. Every native audit waits for a fresh DOM sample confirming both the active view and
hash route; a native heading name alone can match stale or navigation text. This is not device
VoiceOver acceptance.

An audit-call error with XCTest's accessibility-audit domain and code -56 can be retried once,
only if no finding was delivered, after another fresh settled-route check. Both the error and
retry are recorded. Findings are never retried, and a second timeout fails the test.

Handler tracking and guard instrumentation are compiled only into Debug presentation-test builds.
The existing Release Simulator build also scans every file of the built app, including the
executable and resources as bytes, for both guard identifiers. A missing app or missing or empty
executable fails that check rather than passing without inspecting anything.

The four sidebar navigation links and the Continue card's Open the list link use the same accessible
parent-target treatment, preserving their names and actions rather than exempting nested text.
The footer's About link also uses that treatment and the shared `--target` token for its minimum
width and height. These changes apply only to the iOS bundle; no shared markup or Android style changes.
The same parent-target treatment covers breadcrumb links, Library's ratings and tool links,
Search's tool links and More ways to add summary, and Backup & settings' disclosure summaries.
The backup-file labels retain their label-to-file-input association and file-picker activation.
The iOS overlay exposes each as one named button, with Enter and Space activation, and line boxes
and minimum height using the shared `--target` token rather than treating the text as passive.
The associated restore warnings stay visibly unchanged and become descriptions of those buttons,
not separate native text targets. The original file inputs keep their descriptions as well.
Text that labels a control, or describes a rendered or accessibility-exposed control, cannot
enter the passive guard.
Breadcrumb links also use the shared `--target`
token for their minimum width in the iOS overlay: the shared 24-pixel contract permits a narrow
breadcrumb, while the native target needs 44 points. The overlay preserves the existing height.
The 375-point default/largest-text reflow checks and native audit own this iOS-only deviation.
The four Continue actions also mirror their hidden state into their accessibility state. This
addresses WebKit on iOS 18 exposing unnamed button remnants when an empty list hides those actions;
showing an action removes that extra accessibility hiding. Native tests require the empty card to
contain no button nodes, with hosted confirmation pending. Generated-bundle checks exercise hiding
and showing each action.

A separate native More ways to add scenario opens and closes the disclosure with actual taps at
default and largest text sizes. It records the active Search route, open state, summary geometry,
viewport and document widths, and screenshots. Document width must equal viewport width in both
states and sizes, including iPhone SE and iPad. Summary scroll width is recorded, not asserted:
WebKit includes the rotated chevron's unpainted line box, about ten extra pixels at default text.
The Edge `disclosure-chevron-reflow` check owns painted containment at the largest text scale.

The Simulator presentation tests cover both default and largest text sizes, light and dark
appearances, iPhone and iPad windows, and the Read sheet. Hosted validation of the current
presentation corrections is in progress. VoiceOver, hardware keyboard, pointer, actual Files picker
and external-link hand-off behavior still need the owner's device checks.

A separate comic-page scenario uses a bundled comic with requests blocked and cover art off.
It checks that WebKit still exposes the comic's heading, reader action and issue-page link when the
shared phone layout gives `#issue-focus-card` `display: contents`, at default and largest text sizes.
Its native hierarchy and screenshot are recorded for review; the next hosted run must establish
the result. The owner's iPad VoiceOver check of this page remains required before release.

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

The ordinary tests block every http and https request. A separate, explicitly opted-in manual CORS
check contacts the metadata service from the app's origin and requires a real result rather than a
skipped test. The request blocking, and the probe interface the UI tests read results through,
exist only in Debug builds. A repository test reads every Swift file in the app's folder and fails
if any of it, any use of it, or
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

### Capacity sweep and interrupted writes

The P02 size sweep grows valid notes containing text above Latin-1. The newest-runtime and iOS 18.5
jobs in hosted run
[40980346397](https://github.com/raymond-nassar/recap-page/actions/runs/40980346397)
recorded the same thresholds. These are UTF-8 backup-file bytes, not WebKit's charged storage bytes.
They are the largest passing and first failing **sampled** sizes, not an exact binary-search limit.

| Operation | Largest sampled pass (bytes) | First sampled refusal (bytes) |
|---|---:|---:|
| Ordinary save | 4,954,711 | 5,574,047 |
| Reading-data restore into an empty app | 1,362,541 | 1,486,408 |
| Complete restore into an empty app | 1,362,868 | 1,486,735 |
| Reading-data restore into an app holding data | None at or above the owner-size sample | 1,238,660 |
| Complete restore into an app holding data | None at or above the owner-size sample | 1,238,987 |

The generated reading-data owner-size baseline was 1,238,675 bytes. The next 10-percent growth
sample restored into an empty app; the 20-percent sample was refused. That observed file-size
headroom is not a storage guarantee: note characters change the relationship between UTF-8 file
bytes and WebKit's two-byte storage, and the original owner-size dataset left only about 5 percent
of the quota free while restoring.

The Simulator checks also force the app to end at 0, 250 and 750 milliseconds after a save, both
while foregrounded and after moving it to the background. Every observed saved-data hash matched
the whole earlier or later state on both runtimes. A separate complete-restore test fails the
fifth journal write, ends the app, then requires an interrupted, matching recovery with two
completed journal writes and both recovery actions available. These results do not replace
real-device storage-pressure or Files-picker acceptance. The separate fault-disabled proof remains
pending until the presentation checks pass.

## Known limits

- Files export and restore, Read hand-off, Dynamic Type, iPad window sizing and the missing-data
  notice are implemented and under hosted Simulator validation. Actual Files picker, external-link
  hand-off and assistive-technology behavior remain device checks.
- iOS can remove an app's website data when the device runs very low on space, and this app cannot
  opt out of that. The About text recommends keeping an export outside the app, explains that it can
  include progress and notes, and says that deleting the app does not remove exported files.
- iPhone and iPad device backups, to iCloud or to a computer, include this app's saved data. The
  app's privacy text says so.
- Checks that need a real device, such as Read opening the correct comic outside Recap Page, run on the owner's iPad
  with iOS 18; checks that need an iPhone stay unverified until one is available.

## App Store creative assets

The App Store shows two optional images from iOS 27 and iPadOS 27 on: a product page header at
3840 x 1646 and a search results image at 3840 x 2560, each a PNG with no alpha channel. Both are in
`docs/ios-app-store-assets/creative`, with a manifest giving each file's size, bytes, SHA-256, safe
area and inputs. To make them again from the committed iPhone 6.9-inch screenshots:

```
node scripts/ios-creative-assets.mjs
```

The header is drawn from the app icon's geometry and colors, with no text. The search results image
places three of the iPhone screenshots, Library, a reading list partway through and Home,
on the same artwork. `npm test` rebuilds both and fails if an input is missing or either committed
file differs.

Key content stays inside the safe area of Apple's Photoshop templates for the
[header](https://devimages-cdn.apple.com/design/resources/download/app-store/creative_assets-product_page_header_template-static.psd)
and [search results](https://devimages-cdn.apple.com/design/resources/download/app-store/creative_assets-search_results_template-static.psd),
read on 2026-10-31 from each template's "Art Safe Area" layer: left 1097, top 493, right 2743 and
bottom 1154 for the header, and left 836, top 765, right 3004 and bottom 1795 for search results.
The script refuses a layout that leaves them. The templates are not committed; the manifest records
their SHA-256 so a changed template can be noticed.

Nothing is uploaded from here. The owner uploads both images in App Store Connect and checks how
they crop with its preview.

## Signing and internal TestFlight

The manual **iOS TestFlight** workflow has delivered build 4 (4.2.0), built from `7b39b9d3`, to the
internal testing group. Cloud signing, Apple processing and installation on the owner's iPad are
confirmed on #949. The installed build starts offline and retains progress across relaunch.
Update-in-place still waits for build 5, and iPhone-only device checks remain pending until an
iPhone is available. The reservation, export, seal and upload procedure below remains required for
each new build; delivery does not authorize another build or upload without its separate approvals.

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

### External testing: build 5

Build 5 is planned from main at `6a3f6be7`. It combines the iOS file export and restore flow, Read
handoff and presentation work with the shared 4.3.0 changes. These include the Professor X spotlight
and reading path, marking a whole list as read with Undo, shorter Backup & settings help text, and a
dismissible Marvel Unlimited notice on Home. The cloud backup card remains hidden in the iOS app.
Before December 7, 2026, Read opens a recorded Marvel Unlimited reader link when one is available.
From that date, Read opens the Marvel Comics website.

After the build has been uploaded and processed, complete the external testing setup yourself in
App Store Connect:

1. Open Recap Page, choose **TestFlight**, then **Test Information** under **Additional**. Enter the
   approved Beta App Description and your feedback email address. Put the address directly in App
   Store Connect; do not copy it into this repository or a message.
2. Create an external testing group from the plus button beside **External Testing**. An internal
   testing group must already exist.
3. Open the external group, choose **Add Builds**, and select processed build 5. Enter the approved
   **What to Test** text when prompted. Leave automatic tester notifications off if you want to
   invite people only after review.
4. Provide Beta App Review contact information and the approved review notes. State that no sign in
   is required. Submit the build for Beta App Review and wait for Apple's approval.
5. After approval, invite testers by email or create a public link for the group. A public link can
   be shared onward, so use tester criteria and a limit if appropriate. You can disable the link
   later.

The Beta App Description, What to Test and review notes are prepared separately for entry in App
Store Connect. Keep personal contact information out of repository files.

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

Official references, retrieved 2026-10-31:
[cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/),
[API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/),
[upload methods and Xcode requirements](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/),
[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/),
[test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/),
and [external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

## App Store screenshots

The [App Store screenshot assets](ios-app-store-assets/) show the Simulator app with the same
fictional lists as the Google Play listing. They contain no personal reading data, notes, accounts
or comic cover art. The Home notice is dismissed. Images 1 through 4 use the dark theme and dark
Simulator appearance; images 5 through 7 use the light theme and light Simulator appearance. For
the next fictional issue, the capture supplies a fictional synopsis in memory and shows it using
the app's normal description setting. It does not save the synopsis in reading data. The metadata
health check uses the Play preview's fictional response; other requests outside the app bundle are
blocked.

The capture clears the test Simulator app's local storage before each screen. Use a disposable
Simulator, not one with reading data you want to keep. A reader's installed app is not affected.

| Order | Caption | iPad | iPhone |
|---|---|---|---|
| 1 | Start from Home: guided reading paths, storylines and character spotlights. | Expanded sidebar | Yes |
| 2 | Follow the Modern Timeline one reading path at a time, starting with The Modern Avengers. | Collapsed sidebar | Yes |
| 3 | See where you are in a reading list and what to read next. | Collapsed sidebar | Yes |
| 4 | Browse storylines by era, with beginner-friendly picks marked. | Collapsed sidebar | Yes |
| 5 | Preview a character spotlight, such as Professor X, before adding it. | Expanded sidebar | Yes |
| 6 | Keep every reading list in your library, with progress saved on your device. | Expanded sidebar | Yes |
| 7 | Download a complete backup of your lists and progress. | Collapsed sidebar | Yes |

All three sets end at Backup & settings, for seven images each. The iPad About page is short
enough that its data source address would also appear in the frame. Rather than hide the credit or
add space that the app does not show, About is omitted. On iPhone the page also shows development
and TestFlight text that would misdescribe the App Store app and cannot be framed out.

The iPad set mixes the app's expanded sidebar and its collapsed icon rail. The capture seeds the
sidebar preference before the page loads and verifies the requested state before each image.

When the app footer would be visible, the capture hides only that footer with `visibility: hidden`;
it keeps its place in the layout. Apart from dismissing the Home notice and selecting the sidebar
state, no other page content is hidden for framing. The capture checks for visible copyright
notices, web addresses and other platform or store names before taking each image. The Professor X
spotlight scrolls its description out of view, leaving the issue list and its held heading visible;
the text itself is not altered or hidden.

The [manifest](ios-app-store-assets/manifest.json) records each image's caption, dimensions, byte
count, SHA-256, source revision, Simulator device, runtime and capture run, plus the sidebar state
for each iPad image. The iPad Pro 13-inch images are 2064 x 2752 pixels; iPhone 17 Pro images are
1206 x 2622; iPhone 17 Pro Max images are 1320 x 2868. They are portrait PNG files without an
alpha channel, matching
[Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/),
retrieved October 31, 2026.

To regenerate them:

1. In GitHub Actions, start **iOS** on the branch containing the capture tooling and select the
   `app_store_screenshots` input. Leave the other manual inputs off. The equivalent command is
   `gh workflow run iOS --ref <branch> -f app_store_screenshots=true`.
2. Wait for the **App Store screenshots** job and download its
   `ios-app-store-screenshots-<run ID>-<attempt>` artifact. The job builds the unsigned Simulator
   app, applies a 9:41 status bar override and matches each Simulator's appearance to the screen
   theme. It captures the three devices in dark and light phases and checks each image's size and
   opacity. Its seed hook is compiled only in Debug, and the Release scan checks for its identifier.
   Recognized XCTest infrastructure failures are retried once for the affected phase on the same
   Simulator; assertions are not retried. The capture does not sign, use secrets or upload to App
   Store Connect. Captures use a separate concurrency group, so they do not cancel ordinary test
   runs on the same branch, and pushes do not cancel a capture.
3. Inspect every image for the intended screen, theme, clean status bar and framing. Copy the
   artifact's `docs/ios-app-store-assets` output into this directory, preserving the manifest.
   The manifest identifies the exact source revision and Simulator runtime used for that run.
