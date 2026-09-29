# Google Play asset previews

This is maintainer tooling for the bounded asset portion of
[the Play listing work](https://github.com/raymond-nassar/recap-page/issues/577), not a submission
packet or permission to publish. It generates original artwork and cover-free phone-layout
**previews** without a Play Console account, Android SDK, emulator, signing key or live service.
Nothing about the app, its identity or saved reading data changes.

## Generate an unapproved preview packet

Use Node.js 20 or newer, installed Microsoft Edge, and an existing external `puppeteer-core`
installation. The defaults use Edge under Program Files (x86) and the driver's
`lib\puppeteer\puppeteer-core.js` entry under the current user's `.mrt-scratch\node_modules`.
Do not add the browser driver to this repository's dependencies.

From the repository root:

```powershell
npm run play:assets
```

For tools already installed elsewhere, supply their absolute paths:

```powershell
$env:MRT_PUPPETEER = 'C:\external-tools\node_modules\puppeteer-core\lib\puppeteer\puppeteer-core.js'
$env:MRT_EDGE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run play:assets
```

The command prints a new `dist\play-assets-preview-*` directory. It never overwrites an earlier
packet. Generated files remain ignored and must not be committed or uploaded automatically:

| File | Measured output contract |
|---|---|
| `icon-preview.png` | 512 x 512, 32-bit RGBA PNG, opaque square, sRGB, at most 1024 KB |
| `feature-preview.png` | 1024 x 500, 24-bit RGB PNG without alpha |
| `01-library-preview.png` | 1080 x 1920, 24-bit RGB PNG of the Android library layout |
| `02-reading-preview.png` | 1080 x 1920, 24-bit RGB PNG of the Android reading layout |
| `manifest.json` | Source identity and hashes, image dimensions/bytes/checksums, alt text, actual renderer and unapproved status |

The icon reuses the [authored page mark](../scripts/build-icons.mjs), flattened onto its own
purple background so Google, not the source artwork, supplies the outer rounded mask and shadow.
The feature artwork is an original abstract checklist in the same purple, lilac and white.
It contains no third-party logo, comic art, device frame or promotional claim.

## What the screenshots actually show

The [capture command](../scripts/capture-play-assets.mjs) prepares the existing
[Android generated shell](../scripts/prepare-android.mjs) into a temporary directory and renders
its real entry module and mobile stylesheet in **desktop Edge**, using a 360 x 640 CSS-pixel
touch/mobile viewport at scale 3. There is no native Android device or native bridge. These are
not physical-device captures, not release acceptance and not approved final Play screenshots.
The filename and manifest preserve that distinction; keep the manifest with the images.
The library is captured from the top; the reading view is scrolled to its next-issue card,
without changing the layout or hiding controls. Original CSS cover-off placeholders remain visible.

Each screen gets an isolated, disposable browser context. The
[tooling-only fixture](../scripts/play-assets.mjs) supplies two explicitly fictional lists with
12 made-up negative-ID issues and three read markers. It has no notes, availability overrides,
cover URLs, digital reader IDs, publisher URLs or real reader data. The memoized catalog is
replaced with an empty fixture before the first navigation. No fixture is shipped in the app.

Every page request is intercepted before navigation. Only inspected generated shell assets and
three named local fixtures (catalog, metadata health and local health) can be fulfilled.
No request is passed through to the network, and Edge's page network is also set offline.
The fixed `http://127.0.0.1:8787/` origin is retained without opening a listening socket, so this
command does not reuse another session's server or browser profile. Reader pages, popups, real
catalog files, covers and all external requests are refused; an unexpected attempt fails the
packet rather than receiving a generic successful mock response. No Bifrost, Marvel or metadata
endpoint is probed. This is a capture boundary, not a changed production network policy.

The manifest includes the Git revision/tree and dirty status, hashes of inspected source inputs,
the generated Android inventory hash, the fixture hash, Edge version and viewport. It contains
no machine/profile path or saved-state dump. Dirty captures are labeled as such, not described as
the exact committed revision. Browser/font versions can change screenshot bytes, so reproduce
from the recorded source and renderer, then compare actual output rather than assuming identical
compression hashes across machines.

Missing external tools, unapproved/failed requests, browser errors, unsafe visible content,
unexpected state changes, image metadata, corrupted PNGs and incorrect dimensions fail explicitly.
A failed capture removes its own incomplete output; it does not produce a success manifest.
Temporary generated shell and browser state are removed on exit. Do not disable these checks to
get images: inspect the specific failure and update the narrow contract only after review.

## Current technical requirements

Google's [preview asset guidance](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
and [icon specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)
were retrieved on **2026-09-29 UTC**:

| Asset | Requirement used by this tooling |
|---|---|
| App icon | 512 x 512, 32-bit PNG, sRGB, maximum 1024 KB, full square without an outer shadow |
| Feature graphic | 1024 x 500, JPEG or 24-bit PNG, no alpha |
| Phone screenshots | JPEG or 24-bit PNG, no alpha; each dimension 320 to 3840; longest dimension at most twice the shortest |
| Screenshot count | At least two screenshots across supported device types for a listing; this preview provides two phone layouts |

The output is portrait 9:16 without stretching or added device chrome. Alt text is supplied in the
manifest and stays within Google's recommended 140 characters. Technical conformance is not
approval of content, rights or the listing. Google also describes promotional use of submitted
assets, which requires a separate owner rights decision. Recheck current Console requirements
before any final submission.

## Still required before publication

The [rights inventory](https://github.com/raymond-nassar/recap-page/issues/573#issuecomment-5884324176),
[service-use assessment](https://github.com/raymond-nassar/recap-page/issues/574#issuecomment-5884093248)
and [privacy work](https://github.com/raymond-nassar/recap-page/issues/575) remain separate gates.
Original artwork and fictional progress do not approve the app's bundled data, service use,
descriptive marks or public distribution. This tooling does not complete the listing issue.

Before replacing these previews with final listing images, capture the exact authorized Android
release candidate on a supported native device using isolated synthetic data, record the device,
Android/WebView and artifact/source identity, and inspect the actual screen bytes. Verify layout,
system bars, native navigation and relevant file-picker/reader flows through the
[Android acceptance checklist](ANDROID.md#required-real-device-acceptance) and
[release policy](RELEASING.md). Do not represent an app handoff as proof that a comic rendered,
and do not include private notifications, accounts, credentials, comic pages or uncleared covers.

The owner must still decide the developer account and identity, final app name, category,
countries, pricing, public support contact, rights/privacy disposition, app-content declarations,
reviewer-access process and exact approved artifact/assets. No Data safety or legal answers,
reviewer credentials, account registration, signing enrollment, Store upload or publication are
provided by this command. Final screenshots and all approvals remain false in its manifest.
