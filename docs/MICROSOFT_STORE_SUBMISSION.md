# Microsoft Store submission packet

This packet prepares the reviewable values and assets for Recap Page's replacement Microsoft Store
submission. On 2026-09-01 the owner authorized replacing the failed package and selecting **Submit
for certification** after every gate in this packet passes against the exact accepted source and
bundle. That direction does not authorize an account change, new legal acceptance, capability
change, publication, or change to the existing GitHub ZIP release.

Official requirements and public URLs were rechecked on 2026-08-29. Partner Center remains
authoritative when its live wording or validation differs from this packet.

## Owner review card

| Decision | Recommended value | Owner action |
|---|---|---|
| Product | Rejected packages: `2.0.0.0` and `2.0.1.0`. Replacement release: Recap Page 2.0.2, package `2.0.2.0`. | Confirm the exact release candidate |
| Publisher display | PanelStack Labs | Confirm |
| Initial market | United States only | Approve or replace |
| Price | Free, no trial, no sale | Confirm |
| Audience and visibility | Public audience, available and discoverable | Confirm the permanent public-audience choice |
| Publication timing | No scheduled release, manual publishing hold | Select the hold and later approve Publish now |
| Category | Books + reference, Reference | Confirm |
| Listing language | English (United States) | Confirm |
| Personal information answer | Yes | Review the distinction below |
| Privacy, support, and website URLs | Public GitHub pages listed below | Open each anonymously and approve |
| Age rating | Live IARC questionnaire required | Review every current question and generated rating |
| Restricted capability | `runFullTrust` | Approve the justification in the live request |
| Package | Final x64 and ARM64 MSIX bundle only | Verify hash before upload |
| Product update channel | Microsoft Store only; no in-app products | Confirmed 2026-09-01 |

Stop for every unresolved action named in [Live-review stop points](#live-review-stop-points).

## Product identity and package-derived fields

Partner Center reads these values from the uploaded package and reserved product. They are not
listing copy to improvise.

| Field | Exact value | Source |
|---|---|---|
| Product name | Recap Page | Reserved name and package display name |
| Package identity | `PanelStackLabs.RecapPage` | Package manifest |
| Package publisher | `CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472` | Package manifest |
| Publisher display name | PanelStack Labs | Package manifest |
| Package family | `PanelStackLabs.RecapPage_we33aa8nvkpcc` | Partner Center identity |
| Package version | Rejected: `2.0.0.0` and `2.0.1.0`. Replacement: `2.0.2.0`. | Bundle package manifests |
| Architectures | x64 and ARM64 | Bundle package manifests |
| Device family | Windows Desktop | Package manifest |
| Minimum Windows version | Windows 10 version 2004, build `10.0.19041.0` | Package manifest |
| Supported language | `en-us` | Package manifest |
| Restricted capability | `runFullTrust` only | Package manifest |

On the Packages page, upload only the final `.msixbundle`. Partner Center must show the exact
identity, version, both architectures, English language, Desktop device family, and only
`runFullTrust`. Remove and rebuild the package rather than accepting any mismatch. Do not enable
future device families because the manifest intentionally targets Desktop.

## Pricing, availability, and properties

### Pricing and availability

| Partner Center field | Requirement | Recommended value |
|---|---|---|
| Markets | Required, defaults to all possible markets | United States only for the first release |
| Audience | Required, defaults to public | Public audience |
| Discoverability | Required, defaults to discoverable | Make this product available and discoverable in the Microsoft Store |
| Schedule | Required, defaults to release as soon as possible and never stop acquisition | No release date; never stop acquisition |
| Base price | Required | Free |
| Free trial | Optional | None |
| Sale pricing | Optional | None |
| Organizational licensing | Optional | Leave the portal default unless the owner wants organizational acquisition |

The United States only recommendation is deliberately conservative. The app has one `en-us`
listing, opens third-party services whose country availability is not expressed as a complete
official market list, and Microsoft leaves local-law compliance with the publisher. Other markets
can be added in later submissions without changing the package. Do not enable automatic addition of
future markets without a new review.

Use **Don't publish this submission until I select Publish now** in Submission options. This permits
certification to complete before the owner decides whether to replace the existing public GitHub ZIP
as the primary Windows release. Public audience is a one-way choice: Microsoft says a product first
submitted to a public audience cannot later become a private-audience product.

### Category

Use **Books + reference** with the **Reference** subcategory. Microsoft describes the category as
interactive access to material generally found in print and explicitly gives comics as an example.
Recap Page is a reference and progress companion, not a game or a comic reader. Leave secondary
category blank for the first submission.

### Privacy and support

Answer **Yes** when Partner Center asks whether the app accesses, collects, or transmits personal
information. This is a conservative application of Microsoft's current definition, which includes
information that identifies a person or is associated with such information. Recap Page accesses
free-form notes and custom titles stored locally, and a search query a user chooses to enter is sent
to the configured metadata service. A query or note can contain identifying text even though the
app does not ask for it.

This answer does not mean saved reader state is uploaded. Lists, notes, settings, overrides, read
markers, and backups stay in the selected browser profile. Direct services receive only what each
feature needs, such as a search query or issue identity. The distinction must remain explicit in the
listing and privacy policy. Microsoft policy also says packaged desktop products must always have a
privacy policy.

| Field | Public HTTPS value | Status checked 2026-08-29 |
|---|---|---|
| Privacy policy | https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md | Public rendered page, no repository credential required |
| Support contact | https://github.com/raymond-nassar/recap-page/blob/main/SUPPORT.md | Public rendered guide, no repository credential required |
| Website | https://github.com/raymond-nassar/recap-page | Public source and product overview |

Microsoft accepts a support URL or email and requires support contact information only for Xbox, so
the support guide is sufficient for this Desktop app. No private email, phone number, or address is
placed in this repository. If Partner Center asks for regulatory contact details, the owner enters
them privately.

Microsoft does not specifically endorse GitHub as a privacy-policy host. The current rendered
Markdown page is nevertheless a stable public HTTPS page, has no sign-in or download requirement,
and states storage, requests, recipients, controls, and deletion. If the live form offers direct
policy text, paste the same maintained policy there as well as supplying the URL.

### Product declarations and requirements

- Do not select purchases outside Microsoft commerce. Recap Page sells nothing. A separate Marvel
  Unlimited subscription is an external reading dependency, not an in-app purchase.
- Do not claim Microsoft's accessibility declaration until the complete listed keyboard, contrast,
  screen reader, Magnifier, on-screen keyboard, high-contrast, high-DPI, Inspect, and AccChecker
  evidence has been completed.
- Keep alternate-drive and removable-storage installation enabled. The package reads from its
  installed location and saves no reader state there.
- Disable Windows automatic OneDrive backup of package data. Reader state is browser-owned, but
  disabling the declaration keeps the no-upload promise unambiguous.
- Do not select pen and ink, game recording, mixed reality, or generative AI.
- Leave optional hardware checkboxes blank. Package eligibility already limits acquisition to
  supported x64 and ARM64 Windows Desktop systems.

Add these customer-facing requirements:

1. A supported default web browser.
2. Internet access for live metadata, optional cover art, and external reading links.
3. A Marvel Unlimited subscription is required only to read subscription comics.

## English (United States) Store listing

### Product name

Recap Page

### Short description

Plan and track long Marvel Unlimited reading journeys with curated orders, clear next issue
guidance, private notes, and local progress. Recap Page contains no comics and requires your own
subscription for reading.

### Long description

Recap Page is a private reading companion that opens in your installed default web browser. It helps
turn long Marvel comic events, character runs, eras, and continuity paths into manageable reading
sessions.

Browse curated reading lists and Reading Paths, see what comes next, mark issues read or unread, add
private notes, and track custom issues. Your progress stays in your browser profile. There is no
account, advertising, analytics, or telemetry.

When you choose Read, Recap Page opens Marvel Unlimited in your default browser when a direct reader
link is available. Otherwise it opens the official issue page. Reading requires your own Marvel
Unlimited subscription.

Recap Page contains no comic pages. Cover art is optional and loads directly from Marvel image
hosts. Search and issue details use a community metadata service. An optional manual lookup can open
Marvel Fandom.

Curated lists credit Comic Book Herald and Comic Book Reading Orders where their guides supply the
factual issue selection and sequence.

This is an unofficial fan companion. It is not affiliated with or endorsed by Marvel Entertainment
or Disney. Marvel names and marks belong to their respective owners.

### Feature fields

1. Curated event, era, character, and continuity reading orders
2. Reading Paths across connected lists
3. Clear next issue and completion progress
4. Private read markers, notes, availability overrides, and custom entries
5. JSON backup and restore
6. Optional cover art and live metadata
7. Direct links to official Marvel reading pages
8. No account, ads, analytics, or telemetry

### Keywords

1. `comic reading tracker`
2. `reading order`
3. `Marvel Unlimited companion`
4. `comic checklist`
5. `reading progress`
6. `comic events`
7. `comic books`

Keywords were formerly called Search terms. Each keyword is below Microsoft's 40-character limit.
Together they use fewer than 21 unique words.

### Copyright and trademark information

Copyright (c) 2026 Raymond Nassar. Unofficial fan companion, not affiliated with or endorsed by
Marvel Entertainment or Disney. Marvel names and marks belong to their respective owners.

Use **PanelStack Labs** for **Developed by**. Leave **What's new in this version** blank because no
Store version has been published. Leave short title, sort title, and voice title blank.

Leave **Additional license terms** blank. Microsoft's Store license terms govern acquisition of the
Store package, while the source repository separately publishes its code under MIT. Pasting the MIT
text into the Store field would blur those distinct roles. The Website field leads to the repository
and its source license.

## Age-rating answer draft

Every question presented by IARC is required. IARC says its questionnaire is available only inside a
participating storefront. Microsoft says the first category answer controls later questions, and
IARC can revise the questionnaire. This table is a product-fact draft, not reconstructed portal
wording. The owner must read each live question and its information control before answering.

| Topic likely presented | Draft answer | Product evidence and caution |
|---|---|---|
| Existing IARC certificate | No | No prior rating ID is known |
| App category | Reference or the live equivalent for other apps | This is not a game or comic reader |
| Violence, blood, or gore | No for content shipped by Recap Page | The app displays issue titles and labels, not comic pages or narrative descriptions |
| Fear or horror | No for shipped content | Some issue titles contain genre words, but no depicted scenes ship |
| Sexual content or nudity | No | None ships |
| Profanity or crude humor | No | None is intentionally shipped |
| Alcohol, tobacco, or drugs | No | None is intentionally shipped |
| Gambling or simulated gambling | No | None |
| Purchases or randomized purchases | No | The app sells nothing; reading may require a separate existing subscription |
| Users interact with each other | No | No account, chat, multiplayer, social feed, or shared profile |
| User-generated content visible to others | No | Notes, custom entries, and lists stay local |
| Location sharing | No | No location access |
| Advertising | No | None |
| Live generative AI | No | None |
| Directed specifically to children | No | General-audience reference tool |
| External links or online content | Yes if asked | Specific metadata, Marvel, Marvel Fandom, and GitHub requests exist |
| Unrestricted Internet access | Read the live definition | The app is not a browser, but it opens specific pages in the external default browser |
| Personal information sharing | No saved-state sharing | Search queries and issue identities can be sent; saved notes and progress are not |

Optional cover art is enabled in a fresh browser profile and may contain comic imagery supplied by
Marvel's image hosts. The app can switch it off, and the submitted screenshots do so. If the live
questionnaire asks about remotely delivered visual content, answer from that actual behavior rather
than only from the sanitized screenshots.

Microsoft shares the publisher display name and publisher email address with IARC. Review every
generated regional rating before continuing. If IARC refuses a market, remove that market rather
than trying to bypass the result.

## Restricted capability justification

Paste this into the `runFullTrust` explanation after owner review:

> Recap Page declares `runFullTrust` because its packaged classic desktop entry process must start
> the bundled, architecture-matched official Node runtime as a local HTTP server and open the user's
> configured default external browser. The server binds only to `127.0.0.1:8787` and accepts no
> remote connections. It does not request elevation, install or run a background service, listen on
> a network interface, create an account, collect telemetry, or upload saved reading data.
>
> The exact loopback origin and external browser are required for compatibility. Existing reading
> progress is stored by the browser under `http://127.0.0.1:8787`, and changing the host, port, or
> browser container would select a different storage bucket. The external browser also preserves the
> synchronous new-tab behavior required when opening the official reader.

`runFullTrust` is the only restricted capability. The live Partner Center capability request is an
owner-only action and may add certification time.

## Notes for certification

Paste this after updating the date if submission occurs later:

> Prepared 2026-09-01.
>
> Recap Page is a packaged classic desktop app. Launching it starts the bundled
> architecture-matched official Node runtime as a hidden local server bound only to
> `127.0.0.1:8787`. The short-lived launch coordinator waits for that exact package generation,
> opens the installed default browser at that address, and then exits. No console must be kept open.
> No account or test credentials are required.
>
> Core test path:
>
> 1. Launch Recap Page from Start.
> 2. Confirm the default browser opens `http://127.0.0.1:8787/`. A successful launch does not leave
>    a console open.
> 3. Open Browse and preview House of M.
> 4. Under Add comics, find creator Jonathan Hickman and series House of M. These searches use
>    indexes bundled inside the package.
> 5. Add a curated Reading List, mark an issue read, and optionally add a note.
> 6. Close the browser and launch Recap Page again. The same browser profile retains that state.
> 7. The Read action opens Marvel Unlimited when a direct reader link is known, or the official
>    issue page when it is not. Reading requires the tester's own subscription, but list tracking
>    does not.
>
> The app includes no comic pages. Cover art can be disabled under Backup & settings. It makes
> direct requests to a community comics metadata service, Marvel image and reader hosts, an optional
> Marvel Fandom lookup, and no software update service. Saved lists, notes, progress, settings, and
> backups are never uploaded.
>
> Recap Page has no in-app products. The app contains no external updater, release check, download
> link, or replacement instruction. Product updates are installed and updated only through
> Microsoft Store.
>
> [Before pasting, replace this bracketed line with the exact replacement-candidate WACK run URL,
> package-input commit, and result counts. The rejected package's result is historical evidence only.]
>
> The optional Blocked executables test may identify the package's only executable payload, the
> required official Node runtime. Microsoft's Desktop Bridge test documentation says this optional
> result may be ignored when the executable is part of the app.
> DPIAwarenessValidation warned on the Node console process. The customer interface is the external
> browser, and altering Node's embedded manifest would change the vendor executable and invalidate
> its published hash. Partner Center certification remains authoritative.
>
> The package requests only `runFullTrust`. It does not request elevation or a background-task
> capability.

The WACK wording reports measurements and Microsoft's optional-test documentation. It does not claim
that Partner Center has accepted the package or capability.

The rejected package's historical WACK record contained 22 `PASS` categories, one optional
`FAIL`, and one `WARNING`. Those counts are not evidence for the replacement package and must not be
copied into the bracketed line above.

## Listing assets

The five screenshots were captured at 1920 x 1080 from installed Edge with an isolated temporary
profile. Cover art was off, and the app contains no update controls. The first two views use empty
state. The remaining views use one synthetic House of M import with the first five of 20 issues
marked read at fixed January 2026 timestamps and no notes. No private browser profile, progress,
path, email, or account data entered the captures.

| File | Caption for Partner Center |
|---|---|
| `01-home-discovery.png` | Home presents clear ways to browse curated Reading Lists and connected Reading Paths. |
| `02-browse-reading-lists.png` | Browse organizes Reading Lists by timeline, story, character, and other guided routes. |
| `03-reading-paths.png` | Reading Paths show connected stories in sequence and carry sample progress from matching saved lists. |
| `04-reading-progress.png` | A demonstration Reading List keeps the next issue, issue order, and local completion progress together. |
| `05-about-privacy.png` | About explains local storage, direct network requests, source credits, and the unofficial-project boundary. |
| `store-tile-300.png` | Exact 300 x 300 Store tile derived from the existing purple panels app icon. |

Each PNG is below 50 MB and contains only image data chunks. Keep critical content in the top
two-thirds because Store overlays may cover the bottom third. Package icons are separate and remain
unchanged.

Reviewed asset measurements:

| File | Dimensions | Bytes | SHA-256 |
|---|---:|---:|---|
| `01-home-discovery.png` | 1920 x 1080 | 224602 | `A4EC38FB5CA9D8E7E99995BF00DCB42C21E59EF97145504DEEB495E75A9AF0C6` |
| `02-browse-reading-lists.png` | 1920 x 1080 | 176653 | `4F710F86B8D8558ED064D3F38A6C4D4B54D2EBF90B98BD95DD6E9E8F6BF5F19E` |
| `03-reading-paths.png` | 1920 x 1080 | 93419 | `A65510D3E503A02E4ACD8197A2A94F8A18088B417B8D9DFA4BA15F1713F8E5DA` |
| `04-reading-progress.png` | 1920 x 1080 | 307843 | `CCFBB0EBE0EE94450D852FDA992F5D5A1AF0C4471B8F5019B131B3B3CC00080E` |
| `05-about-privacy.png` | 1920 x 1080 | 122777 | `ED6CAD829AE0A1F3EBC04249CEBB90C16135D8DE6D7D598E5B385D6224302C94` |
| `store-tile-300.png` | 300 x 300 | 3060 | `F61B2F972D66CEF3ECBB6723FBE222ADA2C9234A83B4CEB1A8F90336C95C3ECF` |

Omit trailers, 16:9 Super hero art, game poster art, box art, Xbox art, and Holographic art. The
300 x 300 tile is the only new Store logo. A Super hero image is optional promotional artwork with
different safe-area rules, not a stretched version of the purple app icon.

## Final upload handoff

The first submitted bundle failed certification and must not be reused. The runtime fix is merged,
and release integration packages those exact corrected bytes at the final replacement version.
Before the owner uploads a replacement:

1. Freeze the final default branch after every intended release pull request has merged.
2. Confirm the application version is `2.0.2` and the Store package version is `2.0.2.0`.
3. Confirm the submission packet commit is based on that exact branch and the tree is clean.
4. Run lint, tests, counts, sizes, anchors, palette, publication, and the Store packet check.
5. Confirm the installed x64 and ARM64 certification journeys and WACK apply to those exact
   package-copied bytes.
6. Run structural inspection and verify identity, publisher, version, Desktop family, minimum OS,
   `en-us`, x64 and ARM64 slices, only `runFullTrust`, executable count, PE machines, and official
   Node hashes.
7. Compute SHA-256 and record the replacement bundle file name, byte length, hash, package input commit, inspection
   time, and WACK run URL in the private transfer handoff.
8. Transfer only the bundle to the owner. Do not transfer a development PFX, password, raw WACK
   report, runtime download, or machine-path log.
9. After upload, require Partner Center validation to show the expected identity, version,
   architectures, language, Desktop family, and capability before saving the package section.

The rejected submission measured SHA-256
`EB5A6655882B261F87255F3A5D438B69A0233E55996B67F48410FE0200A52C1B`. That value identifies evidence
only and must not appear as the replacement candidate. Microsoft re-signs Store MSIX packages after
certification, so a local development signature is not a production-signing claim.

## Live-review stop points

The 2026-09-01 direction authorizes replacing the package and selecting **Submit for
certification** only when all maintained values remain unchanged and every package gate passes.
Stop for live review before any of these:

1. Selecting or changing markets, audience, discoverability, pricing, or publication timing.
2. Entering private regulatory contact details or changing notification recipients.
3. Saving the personal-information declaration or privacy-policy text.
4. Answering each live IARC question and accepting the generated regional ratings.
5. Approving final listing copy, legal terms, screenshots, tile, and URLs.
6. Requesting approval for `runFullTrust`.
7. Saving a package section whose validation result does not match this packet.
8. Changing the existing GitHub ZIP release policy.
9. Selecting **Publish now** after certification.

Do not upload or submit a package that differs from the accepted source, reviewed hash, or maintained
fields. Do not publish without a separate explicit direction. Do not close issues #188, #360, or
#368 from this preparation work.

Issue #188 can close only after the owner sees the final Partner Center listing and confirms that
the title is exactly **Recap Page**, Marvel appears only as accurate descriptive copy, and the
unofficial, no-comics, and own-subscription disclosures are present.

## Future Store updates

Everything above this heading records the first submission. Its package version, reviewed hash,
manual upload, certification submission, and manual publishing hold remain the factual first-release
procedure. They do not authorize or describe a later update.

After that first free version is live, a published GitHub release may start the separate Microsoft
Store release workflow. The entire job waits at the protected `microsoft-store-production`
environment before it builds or receives Partner Center credentials. The owner must approve that
environment deployment before any update can be uploaded.

The workflow refuses drafts, prereleases, mismatched tags, a product that is not live and free, an
existing pending submission, and a package version that is not greater than the last published
version. It builds the release tag once, inspects and WACK-tests that exact bundle, verifies its hash
again, creates one draft through Microsoft's submission API, and captures its submission ID. It
uploads the bundle archive, sets immediate publication with gradual rollout off, verifies that exact
draft, and commits the same ID once.

Immediate publication means Microsoft publishes the update automatically after certification. It
does not bypass certification or make workflow completion mean the update is already visible. The
workflow never polls certification, deletes a draft, retries a Store mutation automatically, or
changes the GitHub ZIP release. Every Store mutation is one HTTP request without an automatic retry
policy.

If any failure occurs at or after draft upload, do not rerun the workflow. Inspect Partner Center
first and resolve the pending draft manually. A certification failure requires a corrected,
higher-version release rather than moving or reusing the failed release tag.

## Official sources

Retrieved 2026-08-29 and 2026-08-30:

- [Submission checklist](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/create-app-submission)
- [Pricing and availability](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/price-and-availability)
- [Markets](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/market-selection)
- [Visibility](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/visibility-options)
- [Properties](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/enter-app-properties)
- [Categories](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/categories-and-subcategories)
- [Privacy and support](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/support-info)
- [Product declarations](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/product-declarations)
- [System requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/system-requirements)
- [Age ratings](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/age-ratings)
- [IARC questionnaire availability](https://globalratings.com/faq/)
- [Package upload](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/upload-app-packages)
- [Package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Store listing fields](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info)
- [Keywords, copyright, license terms, and Developed by](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/add-additional-information)
- [Screenshots and images](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/screenshots-and-images)
- [Submission options](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/manage-submission-options)
- [Restricted capabilities](https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations)
- [Certification](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-certification-process)
- [Microsoft Store Policies 7.19](https://learn.microsoft.com/windows/apps/publish/store-policies)
- [Desktop Bridge WACK tests](https://learn.microsoft.com/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests)
- [Manage app submissions](https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions)
- [Create an app submission](https://learn.microsoft.com/windows/uwp/monetize/create-an-app-submission)
- [Update an app submission](https://learn.microsoft.com/windows/uwp/monetize/update-an-app-submission)
- [Commit an app submission](https://learn.microsoft.com/windows/uwp/monetize/commit-an-app-submission)
